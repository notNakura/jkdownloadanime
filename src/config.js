module.exports = {
    PORT: process.env.PORT || 3000,

    JKANIME_TIMEOUT_MS: 15000,
    MEDIAFIRE_TIMEOUT_MS: 8000,

    EPISODE_CONCURRENCY: parseInt(process.env.EPISODE_CONCURRENCY || '5', 10) || 5,
    MAX_EPISODES: 2000,

    PROXY_CACHE_TTL_MS: 5 * 60 * 1000,

    USER_AGENT:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};
