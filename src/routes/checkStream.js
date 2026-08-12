const express = require('express');
const crypto = require('crypto');
const pLimit = require('p-limit');
const config = require('../config');
const {
    fetchJkanimePage,
    fetchJkanimePageSession,
    getAnimeInfo,
    parseEpisodeServers
} = require('../services/jkanimeService');
const construirEnlace = require('../services/linkBuilder');
const verificarMega = require('../services/megaService');
const verificarMediafire = require('../services/mediafireService');

const router = express.Router();

const SERVER_CHECK_TIMEOUT_MS = 12000;

function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout tras ${ms}ms verificando ${label}`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function logStep(msg) {
    const ts = new Date().toISOString().split('T')[1].replace('Z', '');
    console.log(`[STREAM ${ts}] ${msg}`);
}

async function checkServer(server, verifyFn, label, ep) {
    if (!server) {
        logStep(`Ep ${ep} - sin servidor ${label} en la página`);
        return null;
    }

    try {
        const remoteDecoded = Buffer.from(server.remote, 'base64').toString('utf-8');
        const enlace = construirEnlace(server, remoteDecoded);

        if (!enlace) {
            logStep(`Ep ${ep} - ⚠️ no se pudo construir el enlace de ${label} (remote: ${remoteDecoded.slice(0, 60)}...)`);
            return null;
        }

        logStep(`Ep ${ep} - 🔍 verificando ${label}...`);
        const start = Date.now();

        const disponible = await withTimeout(verifyFn(enlace), SERVER_CHECK_TIMEOUT_MS, label);

        const ms = Date.now() - start;
        logStep(`Ep ${ep} - ${disponible ? '✅' : '❌'} ${label} ${disponible ? 'disponible' : 'no disponible'} (${ms}ms)`);

        return disponible ? { link: enlace, size: server.size || 'Desconocido' } : null;
    } catch (e) {
        logStep(`Ep ${ep} - ⏱️ ${label} falló/timeout: ${e.message}`);
        return null;
    }
}

async function verificarEpisodio(episodeUrl, ep) {
    const epStart = Date.now();
    try {
        logStep(`Ep ${ep} - 📥 pidiendo página: ${episodeUrl}`);
        const html = await fetchJkanimePage(episodeUrl, { useCache: false });

        const servers = parseEpisodeServers(html);
        if (!servers) {
            logStep(`Ep ${ep} - ⚠️ no se encontró "var servers" en el HTML (posible cambio de JkAnime o bloqueo)`);
            return { episodio: ep, mega: null, mediafire: null };
        }

        logStep(`Ep ${ep} - servidores encontrados: ${servers.map(s => s.server).join(', ')}`);

        const megaServer = servers.find(s => s.server === 'Mega');
        const mediafireServer = servers.find(s => s.server === 'Mediafire');

        const [mega, mediafire] = await Promise.all([
            checkServer(megaServer, verificarMega, 'Mega', ep),
            checkServer(mediafireServer, verificarMediafire, 'Mediafire', ep)
        ]);

        logStep(`Ep ${ep} - ✔️ terminado en ${Date.now() - epStart}ms`);
        return { episodio: ep, mega, mediafire };
    } catch (error) {
        logStep(`Ep ${ep} - ❌ error inesperado: ${error.message}`);
        return { episodio: ep, mega: null, mediafire: null };
    }
}

// ============================================
// JOBS EN MEMORIA (arquitectura de polling)
//
// En vez de mantener una conexión larga (SSE) abierta
// durante todo el proceso, el trabajo corre en background
// y el front va preguntando "¿qué hay nuevo?" cada cierto
// tiempo. Esto evita depender de que ningún proxy/túnel
// intermedio deje pasar datos en tiempo real por una
// conexión larga: cada request de polling es corta y se
// cierra sola, así que nada la puede "retener" hasta el final.
// ============================================
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000; // se limpian solos a los 30 min

setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (now - job.lastAccess > JOB_TTL_MS) jobs.delete(id);
    }
}, 5 * 60 * 1000).unref();

router.post('/check-stream/start', async (req, res) => {
    const { url } = req.body || {};

    if (typeof url !== 'string' || !url.includes('jkanime.net')) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    logStep(`🚀 Nueva verificación solicitada: ${url}`);
    const baseUrl = url.endsWith('/') ? url : url + '/';

    try {
        logStep(`📥 pidiendo página principal: ${baseUrl}`);
        const session = await fetchJkanimePageSession(baseUrl, { useCache: false });
        logStep(`🧩 sesión principal: cookies=${session.cookies.length} cookieHeader=${session.cookieHeader ? "sí" : "NO"} cache=${session.fromCache}`);
        const info = await getAnimeInfo(session.html, {
            sourceUrl: baseUrl,
            useCache: false,
            session
        });

        if (!info) {
            throw new Error('No se pudo obtener la información del anime (¿cambió el HTML de JkAnime?)');
        }

        const totalEpisodes = Math.min(info.totalEpisodes || 0, config.MAX_EPISODES);
        if (info.totalEpisodes > config.MAX_EPISODES) {
            logStep(`⚠️ totalEpisodes=${info.totalEpisodes} excede MAX_EPISODES, se recorta a ${config.MAX_EPISODES}`);
        }

        logStep(
            `📊 "${info.title}" - ${totalEpisodes} episodios` +
            ` (animeId=${info.animeId || 'N/A'})` +
            ` - concurrencia=${config.EPISODE_CONCURRENCY}`
        );

        const jobId = crypto.randomUUID();
        const job = {
            anime: info.title,
            total: totalEpisodes,
            results: [],
            done: false,
            error: null,
            lastAccess: Date.now(),
            startedAt: Date.now()
        };
        jobs.set(jobId, job);

        // Respondemos ya mismo con el jobId; el trabajo pesado
        // sigue corriendo en background y el front lo va a ir
        // consultando con polling.
        res.json({ jobId, anime: info.title, total: totalEpisodes });

        const limit = pLimit(config.EPISODE_CONCURRENCY);
        const tasks = [];
        for (let ep = 1; ep <= totalEpisodes; ep++) {
            const episodeUrl = `${baseUrl}${ep}/`;
            tasks.push(
                limit(async () => {
                    const result = await verificarEpisodio(episodeUrl, ep);
                    job.results.push(result);
                })
            );
        }

        Promise.allSettled(tasks)
            .then(settled => {
                const fallidas = settled.filter(r => r.status === 'rejected');
                if (fallidas.length > 0) {
                    logStep(`⚠️ ${fallidas.length} tareas terminaron con error inesperado: ${fallidas.map(f => f.reason?.message).join(' | ')}`);
                }
                job.done = true;
                logStep(`🏁 verificación completa en ${Date.now() - job.startedAt}ms (${totalEpisodes} episodios) - job ${jobId}`);
            })
            .catch(error => {
                job.error = error.message;
                job.done = true;
                logStep(`❌ error general del job ${jobId}: ${error.message}`);
            });
    } catch (error) {
        logStep(`❌ error iniciando verificación: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

router.get('/check-stream/:jobId/progress', (req, res) => {
    const job = jobs.get(req.params.jobId);

    if (!job) {
        return res.status(404).json({ error: 'La verificación expiró o no existe. Volvé a iniciarla.' });
    }

    job.lastAccess = Date.now();

    const since = Math.max(0, parseInt(req.query.since, 10) || 0);
    const results = job.results.slice(since);

    res.json({
        results,
        nextIndex: job.results.length,
        total: job.total,
        done: job.done,
        error: job.error
    });
});

module.exports = router;
