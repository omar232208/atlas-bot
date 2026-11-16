'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger').child('store');

/**
 * Splits "a.b.c" (or an array) into path segments.
 * @param {string|string[]} p
 * @returns {string[]}
 */
function segments(p) {
  if (Array.isArray(p)) return p.map(String);
  if (p === undefined || p === null || p === '') return [];
  return String(p).split('.');
}

/**
 * Reads a value at a dot path.
 * @param {object} obj
 * @param {string|string[]} p
 * @param {*} [def] Returned when the path does not exist.
 */
function getPath(obj, p, def) {
  let cur = obj;
  for (const key of segments(p)) {
    if (cur === null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, key)) return def;
    cur = cur[key];
  }
  return cur === undefined ? def : cur;
}

/**
 * Writes a value at a dot path, creating intermediate objects.
 * @param {object} obj
 * @param {string|string[]} p
 * @param {*} value
 */
function setPath(obj, p, value) {
  const keys = segments(p);
  if (!keys.length) throw new Error('store: empty path');
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] === null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * Removes the value at a dot path. Returns true if something was removed.
 * @param {object} obj
 * @param {string|string[]} p
 */
function deletePath(obj, p) {
  const keys = segments(p);
  const parent = keys.length > 1 ? getPath(obj, keys.slice(0, -1)) : obj;
  if (!parent || typeof parent !== 'object') return false;
  return delete parent[keys[keys.length - 1]];
}

/**
 * Creates a JSON file store: one file per guild plus "global.json".
 * Data is cached in memory; writes are debounced and atomic (tmp file + rename)
 * so a crash never leaves a half-written file behind.
 * @param {{dir?: string, debounceMs?: number}} [options]
 */
function createStore(options = {}) {
  const dir = path.resolve(options.dir || process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
  const debounceMs = options.debounceMs ?? 1000;
  const cache = new Map();
  const timers = new Map();
  const handles = new Map();

  const fileFor = (name) => path.join(dir, `${name}.json`);

  const load = (name) => {
    if (cache.has(name)) {
      // Re-insert so the Map order is "least recently used first" for trim().
      const hit = cache.get(name);
      cache.delete(name);
      cache.set(name, hit);
      return hit;
    }
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') logger.error(`Could not read ${fileFor(name)}, starting empty:`, err.message);
    }
    cache.set(name, data);
    return data;
  };

  const writeNow = (name) => {
    clearTimeout(timers.get(name));
    timers.delete(name);
    fs.mkdirSync(dir, { recursive: true });
    const target = fileFor(name);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache.get(name) ?? {}, null, 2));
    fs.renameSync(tmp, target);
  };

  const schedule = (name) => {
    if (timers.has(name)) return;
    const timer = setTimeout(() => {
      try { writeNow(name); } catch (err) { logger.error(`Could not save ${name}:`, err); }
    }, debounceMs);
    // A pending save must not keep the process alive on its own; flush() handles exit.
    if (typeof timer.unref === 'function') timer.unref();
    timers.set(name, timer);
  };

  const handle = (name) => {
    if (handles.has(name)) return handles.get(name);
    const h = {
      /** Read a value (deep copy is not made: do not mutate the result, use set/update). */
      get: (p, def) => getPath(load(name), p, def),
      set: (p, value) => { setPath(load(name), p, value); schedule(name); return value; },
      update: (p, fn, def) => {
        const next = fn(getPath(load(name), p, def));
        setPath(load(name), p, next);
        schedule(name);
        return next;
      },
      delete: (p) => { const done = deletePath(load(name), p); if (done) schedule(name); return done; },
      all: () => load(name),
      reset: () => { cache.set(name, {}); schedule(name); }
    };
    handles.set(name, h);
    return h;
  };

  return {
    dir,
    /** @param {string} guildId */
    guild: (guildId) => {
      if (!/^\d+$/.test(String(guildId))) throw new Error(`store: invalid guild id "${guildId}"`);
      return handle(`guild-${guildId}`);
    },
    global: () => handle('global'),
    /** Writes every pending change to disk immediately (synchronous). */
    flush: () => { for (const name of [...timers.keys()]) writeNow(name); },
    /**
     * Keeps at most `max` guild files in memory: saves pending changes, then drops
     * the least recently used ones (they are re-read from disk on next access).
     * Keeps RAM flat on bots that sit in many servers.
     * @param {number} [max]
     * @returns {number} How many entries were dropped.
     */
    trim: (max = 200) => {
      const names = [...cache.keys()].filter((n) => n !== 'global');
      let dropped = 0;
      for (const name of names.slice(0, Math.max(0, names.length - max))) {
        if (timers.has(name)) writeNow(name);
        cache.delete(name);
        dropped++;
      }
      return dropped;
    },
    /** Number of files currently cached in memory. */
    cacheSize: () => cache.size,
    /** Drops the in-memory cache (used by tests to simulate a restart). */
    clearCache: () => { cache.clear(); handles.clear(); }
  };
}

module.exports = createStore();
module.exports.createStore = createStore;
module.exports.getPath = getPath;
module.exports.setPath = setPath;
