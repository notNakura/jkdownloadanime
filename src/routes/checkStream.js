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

// ============================================
// PARSEO DE URL: episodio único o rango
//
// Acepta:
//   https://jkanime.net/baccano/        -> serie completa
//   https://jkanime.net/baccano/1       -> solo episodio 1
//   https://jkanime.net/baccano/1-8     -> episodios 1 a 8
//
// Devuelve { baseUrl, start, end } donde start/end son null
// si no se especificó episodio (revisión completa).
// ============================================
function parseJkanimeInput(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl).trim());
    } catch (_) {
        return null;
    }

    const host = parsed.hostname.replace(/^www\./i, '');
    if (!/(^|\.)jkanime\.net$/i.test(host)) return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    let slugSegments = segments;
    let start = null;
    let end = null;

    const last = segments[segments.length - 1];
    const rangeMatch = last.match(/^(\d+)(?:-(\d+))?$/);

    // Solo lo tratamos como episodio/rango si hay algo más antes en el path
    // (el slug del anime), para no confundir "jkanime.net/123" con un anime.
    if (rangeMatch && segments.length > 1) {
        slugSegments = segments.slice(0, -1);
        start = parseInt(rangeMatch[1], 10);
        end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : start;
        if (end < start) {
            const tmp = start;
            start = end;
            end = tmp;
        }
    }

    if (slugSegments.length === 0) return null;

    const baseUrl = `${parsed.protocol}//${host}/${slugSegments.join('/')}/`;
    return { baseUrl, start, end };
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

    const parsedInput = parseJkanimeInput(url);
    if (!parsedInput) {
        return res.status(400).json({
            error: 'No se pudo interpretar la URL. Usá algo como https://jkanime.net/nombre-anime/, ' +
                '.../nombre-anime/5 (un episodio) o .../nombre-anime/1-8 (un rango).'
        });
    }

    const { baseUrl, start: requestedStart, end: requestedEnd } = parsedInput;

    logStep(
        `🚀 Nueva verificación solicitada: ${url} (base=${baseUrl}` +
        `${requestedStart !== null ? `, rango pedido=${requestedStart}-${requestedEnd}` : ''})`
    );

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

        const totalRealEpisodes = Math.min(info.totalEpisodes || 0, config.MAX_EPISODES);
        if (info.totalEpisodes > config.MAX_EPISODES) {
            logStep(`⚠️ totalEpisodes=${info.totalEpisodes} excede MAX_EPISODES, se recorta a ${config.MAX_EPISODES}`);
        }

        if (totalRealEpisodes <= 0) {
            throw new Error(`No se pudo determinar la cantidad de episodios de "${info.title}".`);
        }

        // Por defecto se revisa la serie completa. Si el usuario pidió un
        // episodio puntual o un rango, se acota a eso — y si ese rango se
        // pasa de la cantidad real de episodios, simplemente se recorta al
        // último episodio real en vez de fallar (el resto sigue andando
        // normal).
        let rangeStart = 1;
        let rangeEnd = totalRealEpisodes;
        let rangeClamped = false;

        if (requestedStart !== null) {
            if (requestedStart > totalRealEpisodes) {
                throw new Error(
                    `El episodio ${requestedStart} no existe: "${info.title}" tiene ${totalRealEpisodes} episodios en total.`
                );
            }
            rangeStart = requestedStart;
            rangeEnd = requestedEnd;
            if (rangeEnd > totalRealEpisodes) {
                rangeEnd = totalRealEpisodes;
                rangeClamped = true;
            }
        }

        const totalToCheck = rangeEnd - rangeStart + 1;

        logStep(
            `📊 "${info.title}" - episodios reales=${totalRealEpisodes}, verificando ${rangeStart}-${rangeEnd}` +
            ` (${totalToCheck})${rangeClamped ? ' [rango recortado al total real]' : ''}` +
            ` (animeId=${info.animeId || 'N/A'})` +
            ` - concurrencia=${config.EPISODE_CONCURRENCY}`
        );

        const jobId = crypto.randomUUID();
        const job = {
            anime: info.title,
            total: totalToCheck,
            rangeStart,
            rangeEnd,
            totalRealEpisodes,
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
        res.json({
            jobId,
            anime: info.title,
            total: totalToCheck,
            rangeStart,
            rangeEnd,
            totalRealEpisodes,
            rangeClamped
        });

        const limit = pLimit(config.EPISODE_CONCURRENCY);
        const tasks = [];
        for (let ep = rangeStart; ep <= rangeEnd; ep++) {
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
                logStep(`🏁 verificación completa en ${Date.now() - job.startedAt}ms (${totalToCheck} episodios) - job ${jobId}`);
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
