'use strict';

const crypto = require('node:crypto');
const store = require('../../../core/store');

/**
 * Giveaway records live at "giveaways.items.<id>" in the guild store. Config
 * is at "giveaways.config" and merged with DEFAULTS on every read, so a
 * partial object written by the dashboard still gives full settings.
 */
const DEFAULTS = Object.freeze({ maxDays: 30, dmWinners: true });
const LIMITS = Object.freeze({ maxDays: [1, 365] });
const MIN_DURATION_MS = 60 * 1000;

/**
 * @param {object} [s] Store.
 * @param {string} guildId
 * @returns {typeof DEFAULTS}
 */
function getConfig(s = store, guildId) {
  const stored = s.guild(guildId).get('giveaways.config', {});
  const cfg = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] !== undefined && stored[key] !== null) cfg[key] = stored[key];
  }
  return cfg;
}

/**
 * Picks up to `count` distinct winners uniformly at random from `entryIds`,
 * leaving out `exclude`. Returns fewer than `count` when there are not enough
 * candidates; never returns duplicates.
 * @param {string[]} entryIds
 * @param {number} count
 * @param {() => number} rng
 * @param {string[]} [exclude]
 * @returns {string[]}
 */
function pickWinners(entryIds, count, rng, exclude = []) {
  const skip = new Set(exclude);
  const pool = entryIds.filter((id) => !skip.has(id));
  const winners = [];
  while (winners.length < count && pool.length) {
    const i = Math.floor(rng() * pool.length);
    winners.push(pool[i]);
    pool[i] = pool[pool.length - 1];
    pool.pop();
  }
  return winners;
}

/**
 * Checks the requirements of a giveaway for one member.
 * @param {{roleIds: string[], accountCreatedAt: number, now: number, requiredRoleId: string|null, minAccountDays: number}} p
 * @returns {null | 'role' | 'age'} null when eligible.
 */
function ineligibility({ roleIds, accountCreatedAt, now, requiredRoleId, minAccountDays }) {
  if (requiredRoleId && !roleIds.includes(requiredRoleId)) return 'role';
  if (minAccountDays > 0 && now - accountCreatedAt < minAccountDays * 24 * 60 * 60 * 1000) return 'age';
  return null;
}

/** Short random id, safe in a button custom id and a slash command option. */
function newId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Lists giveaways of a guild, newest first.
 * @param {object} s Store.
 * @param {string} guildId
 */
function listGiveaways(s, guildId) {
  return Object.values(s.guild(guildId).get('giveaways.items', {}))
    .sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { DEFAULTS, LIMITS, MIN_DURATION_MS, getConfig, pickWinners, ineligibility, newId, listGiveaways };
