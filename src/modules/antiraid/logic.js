'use strict';

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');

/**
 * Pure logic of the antiraid module: settings with defaults, sliding join
 * window, join filters and lockdown permission maths. Nothing here talks to
 * Discord, so it is fully unit-tested.
 */

const ACTIONS = ['kick', 'ban', 'timeout'];
const ADDER_ACTIONS = ['none', 'strip', 'kick', 'ban'];

// Every setting lives at its own flat store path so the dashboard can edit one
// value without rewriting the others. The dashboard schema is built from this
// same table, which guarantees identical paths and defaults.
const SETTINGS = {
  enabled: { path: 'antiraid.enabled', default: false },
  joinThreshold: { path: 'antiraid.joinThreshold', default: 8, min: 3, max: 100 },
  joinWindowSec: { path: 'antiraid.joinWindowSec', default: 10, min: 2, max: 300 },
  raidAction: { path: 'antiraid.raidAction', default: 'kick', options: ACTIONS },
  timeoutMinutes: { path: 'antiraid.timeoutMinutes', default: 60, min: 1, max: 40320 },
  raidDurationMin: { path: 'antiraid.raidDurationMin', default: 15, min: 1, max: 1440 },
  punishBurst: { path: 'antiraid.punishBurst', default: true },
  autoLockdown: { path: 'antiraid.autoLockdown', default: false },
  minAccountAgeMs: { path: 'antiraid.minAccountAgeMs', default: 0, min: 0, max: 31536000000 },
  noAvatar: { path: 'antiraid.noAvatar', default: false },
  filterAction: { path: 'antiraid.filterAction', default: 'kick', options: ACTIONS },
  antiBot: { path: 'antiraid.antiBot', default: true },
  allowVerifiedBots: { path: 'antiraid.allowVerifiedBots', default: false },
  botAdderAction: { path: 'antiraid.botAdderAction', default: 'strip', options: ADDER_ACTIONS },
  dmNotice: { path: 'antiraid.dmNotice', default: true }
};

/**
 * Coerces a stored value to the setting's shape; invalid values fall back to the default
 * (a hand-edited JSON file or an old version must never break detection).
 * @param {object} def Entry of SETTINGS.
 * @param {*} value
 */
function coerce(def, value) {
  if (typeof def.default === 'boolean') return typeof value === 'boolean' ? value : def.default;
  if (typeof def.default === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return def.default;
    return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, Math.round(n)));
  }
  return def.options?.includes(value) ? value : def.default;
}

/**
 * Reads the whole antiraid configuration of a guild with defaults applied.
 * @param {{get: Function}} guildStore store.guild(id)
 * @returns {Record<keyof SETTINGS, *>}
 */
function readConfig(guildStore) {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS)) out[key] = coerce(def, guildStore.get(def.path, def.default));
  return out;
}

/**
 * Sliding time window keyed by any string. Each hit stores a value and returns
 * the values still inside the window, oldest first.
 * @param {{now?: () => number, maxKeys?: number}} [opts]
 */
function createWindow(opts = {}) {
  const now = opts.now || Date.now;
  const maxKeys = opts.maxKeys || 2000;
  const buckets = new Map();
  const prune = (list, windowMs) => {
    const limit = now() - windowMs;
    while (list.length && list[0].at <= limit) list.shift();
  };
  return {
    /**
     * @param {string} key
     * @param {number} windowMs
     * @param {*} [value]
     * @returns {Array<*>}
     */
    hit(key, windowMs, value) {
      let list = buckets.get(key);
      if (!list) {
        // Bounded memory: drop the oldest key when too many guilds/users are tracked.
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        list = [];
        buckets.set(key, list);
      }
      prune(list, windowMs);
      list.push({ at: now(), value });
      return list.map((e) => e.value);
    },
    /** Values currently inside the window, without adding one. */
    peek(key, windowMs) {
      const list = buckets.get(key);
      if (!list) return [];
      prune(list, windowMs);
      return list.map((e) => e.value);
    },
    clear: (key) => buckets.delete(key),
    get size() { return buckets.size; }
  };
}

/**
 * Decides if a joining member is filtered out by the static join filters.
 * @param {ReturnType<typeof readConfig>} cfg
 * @param {{createdAt: number, hasAvatar: boolean}} user
 * @param {number} now
 * @returns {null|'accountAge'|'noAvatar'}
 */
function joinVerdict(cfg, user, now) {
  if (cfg.minAccountAgeMs > 0 && now - user.createdAt < cfg.minAccountAgeMs) return 'accountAge';
  if (cfg.noAvatar && !user.hasAvatar) return 'noAvatar';
  return null;
}

/**
 * True when the number of joins inside the window reaches the raid threshold.
 * @param {number} joins
 * @param {ReturnType<typeof readConfig>} cfg
 */
function isRaid(joins, cfg) {
  return joins >= cfg.joinThreshold;
}

// What a lockdown removes from @everyone. Viewing stays allowed so members can
// still read announcements explaining the situation.
const LOCK_BITS = PermissionFlagsBits.SendMessages | PermissionFlagsBits.SendMessagesInThreads
  | PermissionFlagsBits.CreatePublicThreads | PermissionFlagsBits.CreatePrivateThreads
  | PermissionFlagsBits.AddReactions | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak;

/**
 * Computes the @everyone overwrite during a lockdown from the previous one.
 * @param {{allow: string|bigint, deny: string|bigint}|null} prev
 * @param {bigint} [bits]
 * @returns {{allow: bigint, deny: bigint}}
 */
function lockedOverwrite(prev, bits = LOCK_BITS) {
  const allow = BigInt(prev?.allow ?? 0) & ~bits;
  const deny = BigInt(prev?.deny ?? 0) | bits;
  return { allow, deny };
}

/**
 * Turns raw allow/deny bitfields into the { FlagName: true|false } object that
 * PermissionOverwriteManager.create expects (it replaces the overwrite exactly).
 * @param {string|bigint} allow
 * @param {string|bigint} deny
 * @returns {Record<string, boolean>}
 */
function overwriteOptions(allow, deny) {
  const out = {};
  for (const name of new PermissionsBitField(BigInt(allow)).toArray()) out[name] = true;
  for (const name of new PermissionsBitField(BigInt(deny)).toArray()) out[name] = false;
  return out;
}

module.exports = { ACTIONS, ADDER_ACTIONS, SETTINGS, coerce, readConfig, createWindow, joinVerdict, isRaid, LOCK_BITS, lockedOverwrite, overwriteOptions };
