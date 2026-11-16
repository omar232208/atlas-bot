'use strict';

/**
 * Short-lived in-memory state of the antinuke module. Nothing here needs to
 * survive a restart: a nuke lasts seconds, and restorations work from
 * snapshots taken while the nuke is happening.
 */

/**
 * Map whose entries expire after `ttlMs`, bounded in size so a busy bot cannot leak memory.
 * @param {number} ttlMs
 * @param {{now?: () => number, max?: number}} [opts]
 */
function createTtlMap(ttlMs, opts = {}) {
  const now = opts.now || Date.now;
  const max = opts.max || 5000;
  const map = new Map();
  const alive = (e) => e && e.exp > now();
  return {
    set(key, value) {
      map.delete(key);
      if (map.size >= max) map.delete(map.keys().next().value);
      map.set(key, { value, exp: now() + ttlMs });
    },
    get(key) {
      const e = map.get(key);
      if (!alive(e)) { map.delete(key); return undefined; }
      return e.value;
    },
    has(key) { return this.get(key) !== undefined; },
    delete: (key) => map.delete(key),
    /** Live values whose key starts with `prefix`. */
    valuesWithPrefix(prefix) {
      const out = [];
      for (const [k, e] of map) if (k.startsWith(prefix) && alive(e)) out.push(e.value);
      return out;
    },
    get size() { return map.size; }
  };
}

/**
 * Sliding window per key: hit() records a value and returns those still inside the window.
 * @param {{now?: () => number, maxKeys?: number}} [opts]
 */
function createWindow(opts = {}) {
  const now = opts.now || Date.now;
  const maxKeys = opts.maxKeys || 5000;
  const buckets = new Map();
  return {
    hit(key, windowMs, value) {
      let list = buckets.get(key);
      if (!list) {
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        list = [];
        buckets.set(key, list);
      }
      const limit = now() - windowMs;
      while (list.length && list[0].at <= limit) list.shift();
      list.push({ at: now(), value });
      return list.map((e) => e.value);
    },
    clear: (key) => buckets.delete(key)
  };
}

/**
 * Polls `fn` until it returns something or the timeout passes. Used because the
 * audit log entry and the gateway delete event carrying the snapshot can arrive
 * in either order.
 * @template T
 * @param {() => T|undefined} fn
 * @param {number} timeoutMs
 * @param {number} [stepMs]
 * @returns {Promise<T|undefined>}
 */
async function waitFor(fn, timeoutMs, stepMs = 150) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== undefined || Date.now() >= end) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

// Deleted channels / roles / emojis / stickers, keyed "<guildId>:<id>".
const snapshots = createTtlMap(10 * 60000);
// Channels moved out of a category being deleted, keyed "<guildId>:<oldParentId>:<channelId>".
const orphans = createTtlMap(2 * 60000);
// Executors already caught: any further action from them is undone at once.
const flagged = createTtlMap(10 * 60000);
// Action windows keyed "<guildId>:<executorId>:<action>".
const windows = createWindow();

module.exports = { createTtlMap, createWindow, waitFor, snapshots, orphans, flagged, windows };
