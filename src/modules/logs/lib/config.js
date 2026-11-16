'use strict';

const { PermissionFlagsBits } = require('discord.js');

/** Categories described by the spec; each one is its own channel. */
const CORE_CATEGORIES = ['messages', 'members', 'moderation', 'server', 'voice', 'invites'];
/** Extra categories used by protection modules and tickets. */
const EXTRA_CATEGORIES = ['protection', 'tickets'];
const CATEGORIES = [...CORE_CATEGORIES, ...EXTRA_CATEGORIES];

// Other modules pick their own category names; these aliases route them to the
// channel an admin would expect without forcing every module to know our list.
const ALIASES = {
  automod: 'protection',
  antiraid: 'protection',
  antinuke: 'protection',
  verification: 'members',
  welcome: 'members',
  roles: 'members',
  backup: 'server',
  dashboard: 'server',
  ticket: 'tickets'
};

/** Store paths read by this module (the dashboard schema uses the same strings). */
const PATHS = {
  channel: (category) => `logs.channels.${category}`,
  ignored: 'logs.ignored',
  ignoreBots: 'logs.ignoreBots'
};

const DEFAULTS = { ignored: [], ignoreBots: true };

/**
 * Maps any category name to one of CATEGORIES (unknown names stay as they are).
 * @param {string} category
 * @returns {string}
 */
function canonical(category) {
  const name = String(category || '').toLowerCase();
  return ALIASES[name] || name;
}

/**
 * Finds the configured channel id for a category. Categories that are not one of
 * the six core ones fall back to the moderation channel, so a module-defined
 * event (antinuke, tickets...) is never silently lost when only moderation is set.
 * @param {(path: string, def?: any) => any} get Store getter.
 * @param {string} category
 * @returns {string|null}
 */
function channelIdFor(get, category) {
  const name = canonical(category);
  const id = get(PATHS.channel(name), null);
  if (id) return id;
  if (!CORE_CATEGORIES.includes(name)) return get(PATHS.channel('moderation'), null);
  return null;
}

/**
 * Whether events from this channel must not be logged (ignored list, or a log channel itself
 * so the bot never logs its own log messages).
 * @param {(path: string, def?: any) => any} get
 * @param {string} channelId
 */
function isIgnoredChannel(get, channelId, parentId) {
  if (!channelId) return false;
  const ignored = get(PATHS.ignored, DEFAULTS.ignored) || [];
  if (ignored.includes(channelId) || (parentId && ignored.includes(parentId))) return true;
  return CATEGORIES.some((c) => get(PATHS.channel(c), null) === channelId);
}

/**
 * True when a category currently has a log channel (lets handlers skip costly
 * audit-log lookups when nobody would read the result).
 * @param {object} store
 * @param {string} guildId
 * @param {string} category
 */
function isEnabled(store, guildId, category) {
  return !!channelIdFor(store.guild(guildId).get, category);
}

const SEND_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

/**
 * Creates the function installed in ctx.modlog: it sends an embed to the channel
 * of a category, checking permissions first so a misconfigured channel only logs
 * a warning (once per channel) instead of throwing on every event.
 * @param {{store: object, logger: object}} deps
 * @returns {(guild, category, embed, extra?) => Promise<import('discord.js').Message|null>}
 */
function createSender({ store, logger }) {
  const warned = new Set();
  const warnOnce = (key, msg) => {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn(msg);
  };
  return async (guild, category, embed, extra = {}) => {
    const g = store.guild(guild.id);
    const channelId = channelIdFor(g.get, category);
    if (!channelId) return null;
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased?.()) {
      warnOnce(`${guild.id}:${channelId}:missing`, `Log channel ${channelId} (${category}) not found in ${guild.id}`);
      return null;
    }
    const me = guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    const needed = extra.files?.length ? [...SEND_PERMS, PermissionFlagsBits.AttachFiles] : SEND_PERMS;
    if (!perms || !perms.has(needed)) {
      warnOnce(`${guild.id}:${channelId}:perms`, `Missing permissions to log in #${channel.name} (${guild.id})`);
      return null;
    }
    if (embed && !embed.data?.timestamp && typeof embed.setTimestamp === 'function') embed.setTimestamp();
    warned.delete(`${guild.id}:${channelId}:perms`);
    // Logs must never ping anyone, whatever the embed or content contains.
    return channel.send({ ...extra, embeds: embed ? [embed] : extra.embeds, allowedMentions: { parse: [] } });
  };
}

module.exports = { CATEGORIES, CORE_CATEGORIES, EXTRA_CATEGORIES, ALIASES, PATHS, DEFAULTS, canonical, channelIdFor, isEnabled, isIgnoredChannel, createSender };
