'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { COLLECTIONS } = require('./config');
const { fill, clip } = require('./util');

const TYPES = ['members', 'humans', 'bots', 'boosts', 'tier', 'channels', 'roles'];
const WINDOW_MS = 10 * 60000;
const DEBOUNCE_MS = 15000;

/**
 * Tracks channel renames to respect Discord's limit of 2 renames per 10 minutes
 * per channel. Going over it makes discord.js wait silently for minutes, so we
 * skip and retry later instead.
 * @param {{max?: number, windowMs?: number, now?: () => number}} [opts]
 */
function createRenameLimiter(opts = {}) {
  const max = opts.max ?? 2;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const now = opts.now || Date.now;
  const hits = new Map();
  const recent = (id) => (hits.get(id) || []).filter((at) => now() - at < windowMs);
  return {
    /** Milliseconds before the next rename is allowed (0 = now). */
    waitMs(id) {
      const list = recent(id);
      return list.length < max ? 0 : windowMs - (now() - list[0]);
    },
    /** Records a rename. */
    record(id) {
      const list = recent(id);
      list.push(now());
      hits.set(id, list);
    },
    /** Forgets a channel (deleted). */
    forget: (id) => hits.delete(id)
  };
}

const limiter = createRenameLimiter();

const BOT_COUNT_TTL = WINDOW_MS;
const MAX_FETCH_MEMBERS = 25000;
const botCounts = new Map();

/**
 * Number of bots in a guild. The member cache is swept regularly to save memory,
 * so the full list is fetched at most once per 10 minutes (skipped on huge
 * servers, where the cache value is used as a best effort).
 * @param {import('discord.js').Guild} guild
 * @param {boolean} [needFetch] Only true when a humans/bots channel exists.
 */
async function botCount(guild, needFetch = true) {
  const cached = botCounts.get(guild.id);
  if (cached && Date.now() - cached.at < BOT_COUNT_TTL) return cached.value;
  if (needFetch && guild.memberCount <= MAX_FETCH_MEMBERS && typeof guild.members?.fetch === 'function') {
    await guild.members.fetch({ time: 30000 }).catch(() => null);
  }
  const value = guild.members?.cache ? guild.members.cache.filter((m) => m.user?.bot).size : 0;
  botCounts.set(guild.id, { value, at: Date.now() });
  return value;
}

/**
 * Forgets the cached bot count (a bot joined or left).
 * @param {string} guildId
 */
const invalidateBots = (guildId) => botCounts.delete(guildId);

/**
 * Computes every counter for a guild. memberCount is always exact; the bot
 * count comes from botCount() (or the cache when given directly).
 * @param {import('discord.js').Guild} guild
 * @param {number} [bots] Precomputed bot count.
 * @returns {Record<string, number>}
 */
function counts(guild, bots) {
  const botsValue = bots ?? (guild.members?.cache ? guild.members.cache.filter((m) => m.user?.bot).size : 0);
  return {
    members: guild.memberCount ?? 0,
    humans: Math.max(0, (guild.memberCount ?? 0) - botsValue),
    bots: botsValue,
    boosts: guild.premiumSubscriptionCount ?? 0,
    tier: guild.premiumTier ?? 0,
    channels: guild.channels?.cache?.size ?? 0,
    roles: Math.max(0, (guild.roles?.cache?.size ?? 1) - 1)
  };
}

/**
 * Renders a channel name, with digit grouping of the guild language.
 * @param {string} template Must contain {count}.
 * @param {number} value
 * @param {string} [locale] BCP 47 tag, e.g. "fr-FR".
 */
function render(template, value, locale = 'fr-FR') {
  let count;
  try { count = Number(value).toLocaleString(locale); } catch { count = String(value); }
  return clip(fill(template, { count }), 100);
}

const timers = new Map();

/**
 * Renames every stat channel of a guild whose value changed. Channels that hit
 * the rename limit are retried when the window frees up.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 */
async function refresh(ctx, guild) {
  const g = ctx.store.guild(guild.id);
  const channels = g.get(COLLECTIONS.stats, {});
  if (!Object.keys(channels).length || !ctx.permissions.botCan(guild, PermissionFlagsBits.ManageChannels)) return { renamed: 0, waiting: 0 };
  const needBots = Object.values(channels).some((c) => c.type === 'bots' || c.type === 'humans');
  const values = counts(guild, needBots ? await botCount(guild) : 0);
  const lang = ctx.t(guild, 'community:meta.locale');
  let renamed = 0;
  let retryIn = 0;
  for (const [channelId, cfg] of Object.entries(channels)) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;
    const name = render(cfg.template, values[cfg.type] ?? 0, lang);
    if (channel.name === name) continue;
    const wait = limiter.waitMs(channelId);
    if (wait > 0) { retryIn = Math.max(retryIn, wait); continue; }
    limiter.record(channelId);
    await channel.setName(name).then(() => { renamed++; }).catch((err) => ctx.logger.debug(`[community] stats rename ${channelId}: ${err.message}`));
  }
  if (retryIn) queue(ctx, guild, retryIn + 1000);
  return { renamed, waiting: retryIn ? 1 : 0 };
}

/**
 * Debounced refresh: member joins come in bursts, one rename per burst is enough.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {number} [delay]
 */
function queue(ctx, guild, delay = DEBOUNCE_MS) {
  if (!guild || timers.has(guild.id)) return;
  const timer = setTimeout(() => {
    timers.delete(guild.id);
    refresh(ctx, guild).catch((err) => ctx.logger.warn(`[community] stats refresh ${guild.id}: ${err.message}`));
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(guild.id, timer);
}

/** Has the guild any stat channel? Cheap check used by frequent events. */
const hasStats = (ctx, guildId) => Object.keys(ctx.store.guild(guildId).get(COLLECTIONS.stats, {})).length > 0;

module.exports = { TYPES, createRenameLimiter, limiter, botCount, invalidateBots, counts, render, refresh, queue, hasStats };
