'use strict';

/**
 * Creates an in-memory cooldown tracker. Cooldowns are short-lived on purpose,
 * so they are not persisted across restarts.
 * @param {{now?: () => number}} [opts]
 */
function createCooldowns(opts = {}) {
  const now = opts.now || Date.now;
  const until = new Map();
  return {
    /**
     * Returns the remaining milliseconds if `key` is cooling down, else 0 and starts a new cooldown.
     * @param {string} key e.g. `${commandName}:${userId}`
     * @param {number} ms
     */
    hit(key, ms) {
      const left = (until.get(key) || 0) - now();
      if (left > 0) return left;
      until.set(key, now() + ms);
      if (until.size > 5000) for (const [k, v] of until) if (v <= now()) until.delete(k);
      return 0;
    },
    /** Remaining ms without starting a cooldown. */
    remaining: (key) => Math.max(0, (until.get(key) || 0) - now()),
    reset: (key) => until.delete(key)
  };
}

module.exports = createCooldowns();
module.exports.createCooldowns = createCooldowns;
