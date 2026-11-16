'use strict';

/**
 * In-memory memory of recently deleted messages, used by /snipe.
 *
 * Kept in RAM and never written to disk: deleted messages are personal data,
 * so they are dropped after a short time and lost on restart by design.
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_PER_CHANNEL = 10;

/** channel id -> entries, oldest first. */
const byChannel = new Map();

/**
 * Drops entries older than the TTL, and empties the channel when nothing is left.
 * @param {string} channelId
 * @param {number} now
 * @returns {Array<object>} The entries still alive.
 */
function prune(channelId, now) {
  const alive = (byChannel.get(channelId) ?? []).filter((entry) => now - entry.deletedAt < TTL_MS);
  if (alive.length) byChannel.set(channelId, alive);
  else byChannel.delete(channelId);
  return alive;
}

/**
 * Stores a deleted message.
 * @param {string} channelId
 * @param {{authorId: string, authorName: string, content: string, attachments: string[]}} message
 * @param {number} [now]
 */
function remember(channelId, message, now = Date.now()) {
  const list = prune(channelId, now);
  list.push({ ...message, deletedAt: now });
  if (list.length > MAX_PER_CHANNEL) list.splice(0, list.length - MAX_PER_CHANNEL);
  byChannel.set(channelId, list);
}

/**
 * Recently deleted messages of a channel, most recent first.
 * @param {string} channelId
 * @param {number} [now]
 */
function recent(channelId, now = Date.now()) {
  return prune(channelId, now).slice().reverse();
}

/** Forgets everything (used by tests). */
function clear() {
  byChannel.clear();
}

module.exports = { remember, recent, clear, TTL_MS, MAX_PER_CHANNEL };
