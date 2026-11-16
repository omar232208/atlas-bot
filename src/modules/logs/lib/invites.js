'use strict';

const { PermissionFlagsBits } = require('discord.js');

// guildId -> { invites: Map<code, {uses, maxUses, inviterId}>, vanityUses: number|null }
const cache = new Map();
// Per-guild promise chain: during a raid many joins arrive at once and each one
// must compare against the snapshot left by the previous one.
const queues = new Map();

/** Store paths written by the invite tracker (read by utility /invites). */
const STATS_PATH = 'invites.stats';
const MEMBERS_PATH = 'invites.members';

/**
 * Turns a collection of invites into a plain snapshot map.
 * @param {Iterable<{code: string, uses: number|null, maxUses: number|null, inviterId?: string|null, inviter?: {id: string}}>} invites
 * @returns {Map<string, {uses: number, maxUses: number, inviterId: string|null}>}
 */
function snapshot(invites) {
  const map = new Map();
  for (const inv of invites) {
    map.set(inv.code, { uses: inv.uses ?? 0, maxUses: inv.maxUses ?? 0, inviterId: inv.inviterId ?? inv.inviter?.id ?? null });
  }
  return map;
}

/**
 * Finds which invite was used between two snapshots. An invite whose use count
 * went up is the answer; otherwise an invite that disappeared while one use away
 * from its limit was consumed (Discord deletes it at max uses).
 * @param {Map<string, {uses: number, maxUses: number, inviterId: string|null}>} before
 * @param {Map<string, {uses: number, maxUses: number, inviterId: string|null}>} after
 * @returns {{code: string, uses: number, inviterId: string|null}|null} null when it cannot be told apart.
 */
function findUsedInvite(before, after) {
  const grown = [];
  for (const [code, inv] of after) {
    if (inv.uses > (before.get(code)?.uses ?? 0)) grown.push({ code, uses: inv.uses, inviterId: inv.inviterId });
  }
  if (grown.length === 1) return grown[0];
  if (grown.length > 1) return null;
  const consumed = [];
  for (const [code, inv] of before) {
    if (!after.has(code) && inv.maxUses > 0 && inv.uses + 1 >= inv.maxUses) consumed.push({ code, uses: inv.uses + 1, inviterId: inv.inviterId });
  }
  return consumed.length === 1 ? consumed[0] : null;
}

const canTrack = (guild) => !!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild);

async function fetchState(guild) {
  const invites = snapshot((await guild.invites.fetch()).values());
  let vanityUses = null;
  if (guild.vanityURLCode) vanityUses = await guild.fetchVanityData().then((v) => v.uses).catch(() => null);
  return { invites, vanityUses };
}

/**
 * Caches the current invites of a guild (needs Manage Server). Safe to call often.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<boolean>} false when the bot cannot read invites.
 */
async function cacheGuild(guild) {
  if (!canTrack(guild)) return false;
  try {
    cache.set(guild.id, await fetchState(guild));
    return true;
  } catch {
    return false;
  }
}

/**
 * Updates the cache when an invite is created or deleted, without an API call.
 * @param {import('discord.js').Invite} invite
 * @param {boolean} removed
 */
function trackInvite(invite, removed) {
  const state = invite.guild && cache.get(invite.guild.id);
  if (!state) return;
  if (removed) state.invites.delete(invite.code);
  else state.invites.set(invite.code, { uses: invite.uses ?? 0, maxUses: invite.maxUses ?? 0, inviterId: invite.inviterId ?? invite.inviter?.id ?? null });
}

/**
 * Works out how a member joined, then refreshes the cache.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{type: 'invite', code: string, uses: number, inviterId: string|null}|{type: 'vanity', code: string, uses: number}|{type: 'unknown'}|{type: 'untracked'}>}
 */
function resolveJoin(guild) {
  const run = async () => {
    if (!canTrack(guild)) return { type: 'untracked' };
    const before = cache.get(guild.id);
    let after;
    try { after = await fetchState(guild); } catch { return { type: 'untracked' }; }
    cache.set(guild.id, after);
    if (!before) return { type: 'unknown' };
    const used = findUsedInvite(before.invites, after.invites);
    if (used) return { type: 'invite', ...used };
    if (after.vanityUses !== null && before.vanityUses !== null && after.vanityUses > before.vanityUses) {
      return { type: 'vanity', code: guild.vanityURLCode, uses: after.vanityUses };
    }
    return { type: 'unknown' };
  };
  const next = (queues.get(guild.id) || Promise.resolve()).then(run, run);
  queues.set(guild.id, next.catch(() => {}));
  return next;
}

/**
 * Remembers who invited a member and counts it for the inviter.
 * @param {object} g Guild store handle.
 * @param {string} memberId
 * @param {{type: string, code?: string, inviterId?: string|null}} result
 */
function recordJoin(g, memberId, result) {
  const inviterId = result.type === 'invite' ? result.inviterId : null;
  g.set(`${MEMBERS_PATH}.${memberId}`, { inviterId, code: result.code || null, type: result.type, at: Date.now() });
  if (!inviterId) return;
  g.update(`${STATS_PATH}.${inviterId}`, (s) => ({ joins: (s?.joins || 0) + 1, left: s?.left || 0 }), null);
}

/**
 * Counts a departure against the original inviter and forgets the member.
 * @param {object} g Guild store handle.
 * @param {string} memberId
 * @returns {{inviterId: string|null, code: string|null}|null}
 */
function recordLeave(g, memberId) {
  const entry = g.get(`${MEMBERS_PATH}.${memberId}`, null);
  if (!entry) return null;
  g.delete(`${MEMBERS_PATH}.${memberId}`);
  if (entry.inviterId) g.update(`${STATS_PATH}.${entry.inviterId}`, (s) => ({ joins: s?.joins || 0, left: (s?.left || 0) + 1 }), null);
  return entry;
}

/**
 * Invite leaderboard: [{ userId, joins, left, net }] sorted by net invites.
 * @param {object} g Guild store handle.
 */
function getInviteStats(g) {
  return Object.entries(g.get(STATS_PATH, {}))
    .map(([userId, s]) => ({ userId, joins: s.joins || 0, left: s.left || 0, net: (s.joins || 0) - (s.left || 0) }))
    .sort((a, b) => b.net - a.net || b.joins - a.joins);
}

/** Forgets a guild (bot removed). */
const forgetGuild = (guildId) => { cache.delete(guildId); queues.delete(guildId); };

module.exports = { snapshot, findUsedInvite, cacheGuild, trackInvite, resolveJoin, recordJoin, recordLeave, getInviteStats, forgetGuild, STATS_PATH, MEMBERS_PATH };
