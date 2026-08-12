let baseFetch = typeof fetch !== 'undefined' ? fetch : null;
if (!baseFetch) {
    try {
        baseFetch = require('node-fetch');
    } catch (e) {
        baseFetch = null;
    }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    if (!baseFetch) {
        throw new Error('fetch no disponible: instala Node 18+ o corre "npm install node-fetch"');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await baseFetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Timeout después de ${timeoutMs}ms: ${url}`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = fetchWithTimeout;
