class TTLCache {
    constructor(ttlMs = 5 * 60 * 1000) {
        this.ttl = ttlMs;
        this.store = new Map();
        this.sweepTimer = setInterval(() => this.sweep(), Math.min(ttlMs, 60000));
        this.sweepTimer.unref?.();
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    set(key, value) {
        this.store.set(key, { value, expires: Date.now() + this.ttl });
    }

    sweep() {
        const now = Date.now();
        for (const [key, entry] of this.store) {
            if (now > entry.expires) this.store.delete(key);
        }
    }

    clear() {
        this.store.clear();
    }
}

module.exports = TTLCache;
