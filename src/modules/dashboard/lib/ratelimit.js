'use strict';

/**
 * Fixed-window rate limiter keyed by an arbitrary string (IP + bucket name).
 * Fixed windows are coarse but need one small object per key, which keeps
 * memory flat on a 315 MB host.
 * @param {{limit: number, windowMs: number, now?: () => number, maxKeys?: number}} opts
 */
function createRateLimiter(opts) {
  const { limit, windowMs } = opts;
  const now = opts.now || Date.now;
  const maxKeys = opts.maxKeys || 10000;
  const hits = new Map();

  /**
   * Counts one hit. Returns { ok, retryAfter } (seconds until the window resets).
   * @param {string} key
   */
  const hit = (key) => {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.reset <= t) {
      if (hits.size >= maxKeys) {
        for (const [k, e] of hits) if (e.reset <= t) hits.delete(k);
        // Still full: an attacker is spraying keys, so start over rather than grow.
        if (hits.size >= maxKeys) hits.clear();
      }
      entry = { count: 0, reset: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return { ok: entry.count <= limit, retryAfter: Math.max(1, Math.ceil((entry.reset - t) / 1000)) };
  };

  return { hit, hits };
}

module.exports = { createRateLimiter };
