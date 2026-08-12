const fetchWithTimeout = require('../utils/fetchWithTimeout');
const config = require('../config');

async function verificarMediafire(enlace) {
    if (!enlace) return false;

    try {
        const headRes = await fetchWithTimeout(
            enlace,
            { method: 'HEAD', headers: { 'User-Agent': config.USER_AGENT } },
            config.MEDIAFIRE_TIMEOUT_MS
        );
        if (headRes.ok || headRes.status === 302) return true;
    } catch (e) {}

    try {
        const getRes = await fetchWithTimeout(
            enlace,
            {
                method: 'GET',
                headers: {
                    'User-Agent': config.USER_AGENT,
                    Range: 'bytes=0-0'
                }
            },
            config.MEDIAFIRE_TIMEOUT_MS
        );
        const disponible = getRes.ok || getRes.status === 206 || getRes.status === 302;
        if (getRes.body?.cancel) {
            try { await getRes.body.cancel(); } catch (e) {}
        }
        return disponible;
    } catch (e) {
        return false;
    }
}

module.exports = verificarMediafire;
