'use strict';

// Messages older than 14 days cannot be bulk deleted by Discord.
const BULK_MAX_AGE_MS = 14 * 86400000 - 60000;
const LINK_RE = /https?:\/\/\S+|discord(?:app)?\.(?:gg|com\/invite)\/\S+/i;

/**
 * Whether a message matches the /purge filters (all given filters must match).
 * Works on plain objects shaped like a discord.js Message so it is testable.
 * @param {{author?: {id: string, bot?: boolean}, content?: string, attachments?: {size: number}, embeds?: Array, pinned?: boolean, createdTimestamp: number}} msg
 * @param {{userId?: string, bots?: boolean, humans?: boolean, links?: boolean, attachments?: boolean, embeds?: boolean, contains?: string, keepPinned?: boolean}} filters
 * @param {number} [now]
 */
function matchesPurge(msg, filters = {}, now = Date.now()) {
  if (now - msg.createdTimestamp > BULK_MAX_AGE_MS) return false;
  if (filters.keepPinned !== false && msg.pinned) return false;
  if (filters.userId && msg.author?.id !== filters.userId) return false;
  if (filters.bots && !msg.author?.bot) return false;
  if (filters.humans && msg.author?.bot) return false;
  const content = msg.content || '';
  if (filters.links && !LINK_RE.test(content)) return false;
  if (filters.attachments && !(msg.attachments?.size > 0)) return false;
  if (filters.embeds && !(msg.embeds?.length > 0)) return false;
  if (filters.contains && !content.toLowerCase().includes(filters.contains.toLowerCase())) return false;
  return true;
}

/**
 * Parses a free list of user IDs or mentions ("123 <@456>, 789") for /massban.
 * @param {string} text
 * @returns {string[]} Unique snowflakes in input order.
 */
function parseIds(text) {
  const out = [];
  for (const [, id] of String(text || '').matchAll(/(?:<@!?)?(\d{17,20})>?/g)) if (!out.includes(id)) out.push(id);
  return out;
}

module.exports = { matchesPurge, parseIds, BULK_MAX_AGE_MS };
