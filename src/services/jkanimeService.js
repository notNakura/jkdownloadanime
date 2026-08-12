const fetchWithTimeout = require('../utils/fetchWithTimeout');
const TTLCache = require('../utils/cache');
const config = require('../config');

const pageCache = new TTLCache(config.PROXY_CACHE_TTL_MS);
const episodesCache = new TTLCache(config.PROXY_CACHE_TTL_MS);

function jLog(message, ...args) {
    console.log(`[JKANIME] ${message}`, ...args);
}

function normalizeSetCookieHeaders(response) {
    try {
        if (typeof response.headers.getSetCookie === 'function') {
            return response.headers.getSetCookie();
        }
    } catch (_) {}

    const raw = response.headers.get('set-cookie');
    if (!raw) return [];

    return raw.split(/,(?=[^;=]+=[^;]+)/).map(v => v.trim()).filter(Boolean);
}

function cookieHeaderFromSetCookies(setCookies) {
    return setCookies
        .map(cookie => cookie.split(';', 1)[0].trim())
        .filter(Boolean)
        .join('; ');
}

async function fetchJkanimePageSession(targetUrl, { useCache = true } = {}) {
    if (!targetUrl || !targetUrl.includes('jkanime.net')) {
        const err = new Error('Solo se permiten URLs de JkAnime');
        err.status = 400;
        throw err;
    }

    if (useCache) {
        const cached = pageCache.get(targetUrl);
        if (cached) {
            jLog(`GET cache HIT ${targetUrl}`);
            return { html: cached, cookies: [], fromCache: true };
        }
    }

    jLog(`GET ${targetUrl}`);

    const response = await fetchWithTimeout(
        targetUrl,
        {
            headers: {
                'User-Agent': config.USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            redirect: 'follow'
        },
        config.JKANIME_TIMEOUT_MS
    );

    const cookies = normalizeSetCookieHeaders(response);
    const cookieHeader = cookieHeaderFromSetCookies(cookies);

    jLog(
        `GET resultado HTTP=${response.status} finalURL=${response.url || targetUrl} ` +
        `cookies=${cookies.length} cookieHeader=${cookieHeader ? 'sí' : 'no'}`
    );

    if (!response.ok) {
        const err = new Error(`Error HTTP ${response.status}`);
        err.status = response.status;
        throw err;
    }

    const html = await response.text();

    jLog(`GET HTML recibido bytes=${Buffer.byteLength(html, 'utf8')}`);

    if (useCache) pageCache.set(targetUrl, html);

    return { html, cookies, cookieHeader, fromCache: false };
}

async function fetchJkanimePage(targetUrl, { useCache = true } = {}) {
    const session = await fetchJkanimePageSession(targetUrl, { useCache });
    return session.html;
}

function parseAnimeInfo(html) {
    if (!html) return null;

    const episodeMatch = html.match(/<span>\s*Episodios:\s*<\/span>\s*(\d+)/i);
    const titleMatch = html.match(/<h3>([^<]+)<\/h3>/i);
    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const animeIdMatch = html.match(/id=["']guardar-anime["'][^>]*data-anime=["'](\d+)["']/i);
    const csrfMatch = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);

    return {
        totalEpisodes: episodeMatch ? parseInt(episodeMatch[1], 10) : null,
        animeId: animeIdMatch ? parseInt(animeIdMatch[1], 10) : null,
        token: csrfMatch ? csrfMatch[1] : null,
        title: ogTitleMatch ? ogTitleMatch[1].trim() : (titleMatch ? titleMatch[1].trim() : 'Anime')
    };
}

function parseAjaxJson(text) {
    if (!text) return null;
    const trimmed = text.trim();

    try {
        return JSON.parse(trimmed);
    } catch (_) {}

    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
        try {
            return JSON.parse(trimmed.slice(first, last + 1));
        } catch (_) {}
    }

    return null;
}

async function fetchEpisodePageAjax(animeId, token, cookieHeader, sourceUrl, page = 1) {
    const url = `https://jkanime.net/ajax/episodes/${animeId}/${page}`;

    const headers = {
        'User-Agent': config.USER_AGENT,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: sourceUrl,
        Origin: 'https://jkanime.net'
    };

    if (cookieHeader) headers.Cookie = cookieHeader;

    jLog(
        `AJAX REQUEST anime=${animeId} page=${page} ` +
        `token=${token ? `sí(${token.length})` : 'NO'} ` +
        `cookies=${cookieHeader ? 'sí' : 'NO'} referer=${sourceUrl}`
    );

    const response = await fetchWithTimeout(
        url,
        {
            method: 'POST',
            headers,
            body: `_token=${encodeURIComponent(token || '')}`
        },
        config.JKANIME_TIMEOUT_MS
    );

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    jLog(
        `AJAX RESPONSE anime=${animeId} page=${page} HTTP=${response.status} ` +
        `content-type=${contentType} bytes=${Buffer.byteLength(text, 'utf8')}`
    );

    if (response.status === 419) {
        jLog(`AJAX 419 body[0:500]=${text.slice(0, 500)}`);
        return { ok: false, status: 419, data: null, text };
    }

    const data = parseAjaxJson(text);

    if (!data) {
        jLog(`AJAX NO-JSON body[0:500]=${text.slice(0, 500)}`);
        return { ok: false, status: response.status, data: null, text };
    }

    const items = Array.isArray(data.data) ? data.data : [];
    jLog(
        `AJAX JSON OK anime=${animeId} page=${page} ` +
        `current_page=${data.current_page ?? '?'} total=${data.total ?? '?'} items=${items.length}`
    );

    if (items.length) {
        const nums = items.map(x => x?.number).filter(x => x !== undefined);
        jLog(`AJAX episodios encontrados page=${page}: ${nums.slice(0, 20).join(',')}${nums.length > 20 ? ',...' : ''}`);
    }

    return { ok: response.ok || response.status === 200, status: response.status, data, text };
}

async function fetchEpisodeCount(animeId, token, {
    useCache = true,
    referer = 'https://jkanime.net/',
    cookieHeader = ''
} = {}) {
    if (!animeId || !token) {
        jLog(`fetchEpisodeCount cancelado: animeId=${animeId} token=${token ? 'sí' : 'NO'}`);
        return null;
    }

    const cacheKey = `episodes:${animeId}`;
    if (useCache) {
        const cached = episodesCache.get(cacheKey);
        if (cached !== null && cached !== undefined) {
            jLog(`episodios cache HIT anime=${animeId}: ${cached}`);
            return cached;
        }
    }

    const first = await fetchEpisodePageAjax(animeId, token, cookieHeader, referer, 1);

    if (first.data) {
        const total = Number(first.data.total);
        if (Number.isFinite(total) && total >= 0) {
            if (useCache) episodesCache.set(cacheKey, total);
            return total;
        }

        return await discoverEpisodeCountByPages(animeId, token, cookieHeader, referer, first.data);
    }

    return null;
}

async function discoverEpisodeCountByPages(animeId, token, cookieHeader, referer, firstData = null) {
    const seen = new Set();
    const maxPages = 100;

    const consume = data => {
        for (const item of (Array.isArray(data?.data) ? data.data : [])) {
            const n = Number(item?.number);
            if (Number.isFinite(n) && n > 0) seen.add(n);
        }
    };

    consume(firstData);

    for (let page = 2; page <= maxPages; page++) {
        const result = await fetchEpisodePageAjax(animeId, token, cookieHeader, referer, page);
        if (!result.data) break;

        const before = seen.size;
        consume(result.data);
        const added = seen.size - before;
        const items = Array.isArray(result.data.data) ? result.data.data.length : 0;

        if (items === 0 || added === 0) break;
    }

    const total = seen.size ? Math.max(...seen) : 0;
    jLog(`FALLBACK CONTADOR anime=${animeId}: encontrados=${seen.size} maxEpisode=${total}`);
    return total || null;
}

async function getAnimeInfo(html, { useCache = true, sourceUrl = 'https://jkanime.net/', session = null } = {}) {
    const info = parseAnimeInfo(html);
    if (!info) return null;

    jLog(
        `parseAnimeInfo title="${info.title}" animeId=${info.animeId ?? 'N/A'} ` +
        `htmlEpisodes=${info.totalEpisodes ?? 'N/A'} token=${info.token ? `sí(${info.token.length})` : 'NO'}`
    );

    if (info.totalEpisodes > 0) return info;

    if (!info.animeId || !info.token) {
        jLog(`NO AJAX: faltan datos animeId=${info.animeId} token=${info.token ? 'sí' : 'NO'}`);
        return info;
    }

    const ajaxTotal = await fetchEpisodeCount(info.animeId, info.token, {
        useCache,
        referer: sourceUrl,
        cookieHeader: session?.cookieHeader || ''
    });

    if (ajaxTotal !== null) info.totalEpisodes = ajaxTotal;
    else jLog(`NO se pudo determinar total para anime=${info.animeId}; queda ${info.totalEpisodes}`);

    return info;
}

function parseEpisodeServers(html) {
    if (!html) return null;
    const serversMatch = html.match(/var\s+servers\s*=\s*(.+?);/s);
    if (!serversMatch) return null;

    const serversText = serversMatch[1].trim();
    try { return JSON.parse(serversText); } catch (_) {}
    try { return JSON.parse(serversText.replace(/'/g, '"')); } catch (_) { return null; }
}

module.exports = {
    fetchJkanimePage,
    fetchJkanimePageSession,
    parseAnimeInfo,
    fetchEpisodeCount,
    getAnimeInfo,
    parseEpisodeServers
};
