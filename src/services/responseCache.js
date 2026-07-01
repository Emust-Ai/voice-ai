class ResponseCache {
  constructor() {
    this.cache = new Map();
    this.defaultTtl = {
      tenant_find: 5 * 60 * 1000,
      station_verification: 60 * 1000,
      charge_station_tariff: 10 * 60 * 1000,
      check_cdrs: 30 * 1000,
      check_invoice: 30 * 1000,
    };
    this.refreshTimers = new Map();
  }

  buildKey(toolName, args) {
    const stable = Object.keys(args)
      .sort()
      .map(k => `${k}=${args[k]}`)
      .join('&');
    return `${toolName}:${stable}`;
  }

  get(toolName, args) {
    const key = this.buildKey(toolName, args);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(toolName, args, data, ttlMs) {
    const key = this.buildKey(toolName, args);
    const ttl = ttlMs || this.defaultTtl[toolName] || 30 * 1000;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
      toolName,
      args
    });
  }

  invalidate(toolName, args) {
    if (args) {
      this.cache.delete(this.buildKey(toolName, args));
    } else {
      for (const [key, entry] of this.cache.entries()) {
        if (entry.toolName === toolName) {
          this.cache.delete(key);
        }
      }
    }
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

export const responseCache = new ResponseCache();
