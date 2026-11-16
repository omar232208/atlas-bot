'use strict';

const { fingerprint } = require('./filters');

// Longest window any rate filter may use; older entries are dropped.
const MAX_WINDOW_MS = 120000;

/**
 * In-memory rate tracker for the spam, duplicate and attachment filters.
 * Kept in memory on purpose: rates only matter over seconds, and persisting
 * every message would cost disk writes for nothing.
 * @param {{now?: () => number, maxKeys?: number}} [opts]
 */
function createTracker(opts = {}) {
  const now = opts.now || Date.now;
  const maxKeys = opts.maxKeys || 5000;
  const entries = new Map();

  const prune = (list, at) => list.filter((e) => at - e.at <= MAX_WINDOW_MS);

  return {
    /**
     * Records a message and returns the rates relevant to it.
     * @param {string} key Usually `${guildId}:${userId}`.
     * @param {{messageId: string, channelId: string, content?: string, attachments?: number}} msg
     * @param {{spamSeconds: number, duplicateSeconds: number, attachmentSeconds: number}} windows
     * @returns {{messages: number, duplicates: number, attachments: number}}
     */
    record(key, msg, windows) {
      const at = now();
      const list = prune(entries.get(key) || [], at);
      const print = fingerprint(msg.content);
      list.push({ at, messageId: msg.messageId, channelId: msg.channelId, print, attachments: msg.attachments || 0 });
      entries.set(key, list);
      if (entries.size > maxKeys) {
        for (const [k, v] of entries) if (!v.length || at - v[v.length - 1].at > MAX_WINDOW_MS) entries.delete(k);
      }
      const within = (s) => list.filter((e) => at - e.at <= s * 1000);
      return {
        messages: within(windows.spamSeconds).length,
        // Messages without text (only a file or sticker) are never duplicates.
        duplicates: print ? within(windows.duplicateSeconds).filter((e) => e.print === print).length : 0,
        attachments: within(windows.attachmentSeconds).reduce((n, e) => n + e.attachments, 0)
      };
    },
    /**
     * Recent message IDs of a user, grouped by channel, so a spam burst can be
     * bulk deleted instead of only the last message.
     * @param {string} key
     * @param {number} seconds
     * @returns {Map<string, string[]>}
     */
    recentIds(key, seconds) {
      const at = now();
      const out = new Map();
      for (const e of entries.get(key) || []) {
        if (at - e.at > seconds * 1000) continue;
        if (!out.has(e.channelId)) out.set(e.channelId, []);
        out.get(e.channelId).push(e.messageId);
      }
      return out;
    },
    /** Forgets a user's history (after a sanction, so one burst is punished once). */
    reset(key) { entries.delete(key); },
    get size() { return entries.size; }
  };
}

module.exports = { createTracker, MAX_WINDOW_MS };
