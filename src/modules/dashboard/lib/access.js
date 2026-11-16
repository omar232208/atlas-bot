'use strict';

const { PermissionFlagsBits } = require('discord.js');

const CACHE_MS = 60 * 1000;

/**
 * Per-request authorization: the user must still be in the guild with Manage
 * Server, or be its owner / listed in OWNER_IDS. Member lookups are cached
 * 60 s so a page that fires several API calls costs one Discord request.
 * @param {{client: object, permissions: object}} ctx
 * @param {{now?: () => number}} [opts]
 */
function createAccess(ctx, opts = {}) {
  const now = opts.now || Date.now;
  const cache = new Map();

  /**
   * @param {string} guildId
   * @param {string} userId
   * @returns {Promise<object|null>} the guild when allowed, null otherwise
   */
  const check = async (guildId, userId) => {
    const guild = ctx.client?.guilds?.cache?.get(guildId);
    if (!guild) return null;
    if (ctx.permissions.isOwner(guild, userId)) return guild;
    const key = `${guildId}:${userId}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return hit.allowed ? guild : null;
    let allowed = false;
    try {
      // force: true skips discord.js' member cache, which can be stale after a role change.
      const member = await guild.members.fetch({ user: userId, force: true });
      allowed = !!member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    } catch {
      allowed = false;
    }
    if (cache.size > 5000) cache.clear();
    cache.set(key, { allowed, expires: now() + CACHE_MS });
    return allowed ? guild : null;
  };

  /** Forgets a cached decision (after logout, for instance). */
  const forget = (userId) => {
    for (const key of cache.keys()) if (key.endsWith(`:${userId}`)) cache.delete(key);
  };

  return { check, forget, cache };
}

/**
 * Channels and roles of a guild, in display order, as plain JSON.
 * @param {object} guild
 */
function resources(guild) {
  const channels = [...guild.channels.cache.values()]
    .filter((c) => !c.isThread?.())
    .map((c) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId || null, position: c.rawPosition ?? c.position ?? 0 }))
    .sort((a, b) => a.position - b.position);
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor && r.hexColor !== '#000000' ? r.hexColor : null, position: r.position, managed: !!r.managed }))
    .sort((a, b) => b.position - a.position);
  return { channels, roles };
}

/**
 * Counts open tickets from whatever shape the tickets module stores; returns
 * null when nothing ticket-like is stored so the UI can hide the tile.
 * @param {object} gs Guild store handle.
 * @returns {number|null}
 */
function countOpenTickets(gs) {
  const root = gs.get('tickets', null);
  if (!root || typeof root !== 'object') return null;
  const isOpen = (tk) => tk && typeof tk === 'object' && (tk.status ? tk.status === 'open' : !tk.closedAt && !tk.closed);
  for (const key of ['open', 'tickets', 'list', 'active']) {
    const v = root[key];
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' || isOpen(x)).length;
    if (v && typeof v === 'object') return Object.values(v).filter((x) => typeof x === 'string' || isOpen(x)).length;
  }
  return null;
}

module.exports = { createAccess, resources, countOpenTickets };
