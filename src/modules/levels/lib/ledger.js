'use strict';

const { progress, levelFromXp } = require('./xp');

/**
 * Adds the XP of one message, subject to the per-member cooldown. Saves the
 * record at "levels.users.<id>". Runs synchronously inside store.update, so
 * concurrent messages cannot lose XP.
 * @param {object} s Store.
 * @param {string} guildId
 * @param {string} userId
 * @param {{cooldown: number, xpMin: number, xpMax: number}} cfg
 * @param {number} now
 * @param {() => number} rng
 * @returns {{awarded: boolean, from: number, to: number}}
 */
function awardMessage(s, guildId, userId, cfg, now, rng) {
  let result = { awarded: false, from: 0, to: 0 };
  s.guild(guildId).update(`levels.users.${userId}`, (raw) => {
    const rec = { xp: raw?.xp || 0, last: raw?.last || 0 };
    const from = levelFromXp(rec.xp);
    if (now - rec.last < cfg.cooldown * 1000) {
      result = { awarded: false, from, to: from };
      return rec;
    }
    const lo = Math.min(cfg.xpMin, cfg.xpMax);
    const hi = Math.max(cfg.xpMin, cfg.xpMax);
    rec.xp += lo + Math.floor(rng() * (hi - lo + 1));
    rec.last = now;
    result = { awarded: true, from, to: levelFromXp(rec.xp) };
    return rec;
  });
  return result;
}

/**
 * Member record with level data, for /rank.
 * @param {object} s
 * @param {string} guildId
 * @param {string} userId
 */
function getProgress(s, guildId, userId) {
  const xp = s.guild(guildId).get(`levels.users.${userId}.xp`, 0);
  return { xp, ...progress(xp) };
}

/** Rank (1 = most XP) of a member among everyone with XP on this server. */
function rankOf(s, guildId, userId) {
  const users = s.guild(guildId).get('levels.users', {});
  const mine = users[userId]?.xp || 0;
  return 1 + Object.entries(users).filter(([id, rec]) => id !== userId && (rec?.xp || 0) > mine).length;
}

module.exports = { awardMessage, getProgress, rankOf };
