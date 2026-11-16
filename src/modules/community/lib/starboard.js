'use strict';

const { PermissionFlagsBits, Routes } = require('discord.js');
const embeds = require('../../../core/embeds');
const { setting, COLLECTIONS } = require('./config');
const { NS, clip, serial } = require('./util');

const IMAGE_RE = /\.(png|jpe?g|gif|webp)(\?|$)/i;

/**
 * Normalises a user-typed emoji: a custom emoji "<:star:123>" keeps its markup,
 * a unicode emoji is kept as is. Returns null for text that cannot be an emoji.
 * @param {string} input
 * @returns {string|null}
 */
function parseEmoji(input) {
  const text = String(input || '').trim();
  if (/^<a?:\w{2,32}:\d{17,20}>$/.test(text)) return text;
  // Unicode emoji: short, no letters/digits/spaces (rules out plain words).
  if (text && text.length <= 16 && !/[\s\p{L}\p{N}]/u.test(text.replace(/️|‍/g, ''))) return text;
  return null;
}

/**
 * Whether a reaction emoji is the configured star emoji.
 * @param {{id?: string|null, name?: string|null}} emoji Reaction emoji.
 * @param {string} configured Value from parseEmoji.
 */
function emojiMatches(emoji, configured) {
  if (!emoji || !configured) return false;
  const custom = /^<a?:\w+:(\d+)>$/.exec(configured);
  if (custom) return emoji.id === custom[1];
  const clean = (s) => String(s || '').replace(/️/g, '');
  return !emoji.id && clean(emoji.name) === clean(configured);
}

/**
 * Counts valid stars: bots never count; the author counts only when self-star is on.
 * @param {Iterable<{id: string, bot?: boolean}>} users
 * @param {string} authorId
 * @param {boolean} selfStar
 */
function countStars(users, authorId, selfStar) {
  let n = 0;
  for (const u of users) if (!u.bot && (selfStar || u.id !== authorId)) n++;
  return n;
}

/**
 * Encodes the configured emoji for the reactions REST route.
 * @param {string} configured Value from parseEmoji.
 */
function routeEmoji(configured) {
  const custom = /^<a?:(\w+):(\d+)>$/.exec(configured);
  return custom ? `${custom[1]}:${custom[2]}` : encodeURIComponent(configured);
}

/**
 * Users who reacted with the star emoji (first 100). Asked to the API directly
 * because the bot keeps no reaction cache, to stay within its memory budget.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 * @param {string} emoji
 * @returns {Promise<Array<{id: string, bot?: boolean}>>}
 */
async function fetchStarUsers(ctx, message, emoji) {
  try {
    const users = await ctx.client.rest.get(Routes.channelMessageReaction(message.channelId, message.id, routeEmoji(emoji)), { query: new URLSearchParams({ limit: '100' }) });
    return Array.isArray(users) ? users : [];
  } catch (err) {
    // 10014 Unknown Emoji: nobody reacted with it any more.
    if (err.code !== 10014) ctx.logger.debug(`[community] starboard reactions: ${err.message}`);
    return [];
  }
}

/**
 * Picks the first image of a message (attachment or embed) for the board post.
 * @param {import('discord.js').Message} message
 */
function firstImage(message) {
  const att = [...(message.attachments?.values?.() || [])].find((a) => a.contentType?.startsWith('image/') || IMAGE_RE.test(a.url || ''));
  if (att) return att.url;
  const em = (message.embeds || []).find((e) => e.image?.url || e.thumbnail?.url);
  return em?.image?.url || em?.thumbnail?.url || null;
}

/**
 * Builds the starboard message for a source message.
 * @param {Function} t
 * @param {import('discord.js').Message} message
 * @param {number} count
 * @param {string} emoji
 */
function buildPost(t, message, count, emoji) {
  const guild = message.guild;
  const fields = [{ name: t(guild, `${NS}:starboard.source`), value: t(guild, `${NS}:starboard.jump`, { url: message.url }), inline: true }];
  const files = [...(message.attachments?.values?.() || [])].filter((a) => !IMAGE_RE.test(a.url || '') && !a.contentType?.startsWith('image/'));
  if (files.length) fields.push({ name: t(guild, `${NS}:starboard.attachments`), value: clip(files.map((a) => `[${a.name}](${a.url})`).join('\n'), 1024), inline: true });
  const embed = embeds.base({ description: clip(message.content || '', 4000) || undefined, fields })
    .setAuthor({ name: clip(message.member?.displayName || message.author?.username || '?', 256), iconURL: message.author?.displayAvatarURL?.({ size: 64 }) })
    .setTimestamp(message.createdTimestamp || Date.now());
  const image = firstImage(message);
  if (image) embed.setImage(image);
  return {
    content: t(guild, `${NS}:starboard.header`, { emoji, count, channel: `<#${message.channelId}>` }),
    embeds: [embed],
    allowedMentions: { parse: [] }
  };
}

/**
 * Recomputes the stars of a message and creates, edits or removes its board post.
 * Serialised per message: reaction bursts must not create two posts.
 * @param {object} ctx
 * @param {import('discord.js').Message} message A fully fetched message.
 */
function sync(ctx, message) {
  return serial(`star:${message.id}`, async () => {
    const guild = message.guild;
    const g = ctx.store.guild(guild.id);
    if (!setting(g, 'community.starboard.enabled')) return;
    const boardId = setting(g, 'community.starboard.channelId');
    const board = boardId ? guild.channels.cache.get(boardId) : null;
    if (!board?.isTextBased?.() || message.channelId === board.id) return;
    if (setting(g, 'community.starboard.ignoredChannels').includes(message.channelId)) return;
    // Never leak NSFW content into a channel that is not marked NSFW.
    if (message.channel?.nsfw && !board.nsfw) return;
    if (!ctx.permissions.botCan(guild, PermissionFlagsBits.SendMessages, board)) return;

    const emoji = setting(g, 'community.starboard.emoji');
    const users = await fetchStarUsers(ctx, message, emoji);
    const count = countStars(users, message.author.id, setting(g, 'community.starboard.selfStar'));
    const postPath = [...COLLECTIONS.starboardPosts.split('.'), message.id];
    const post = g.get(postPath, null);
    const threshold = Math.max(1, Number(setting(g, 'community.starboard.threshold')) || 1);
    const existing = post ? await board.messages.fetch(post.boardMessageId).catch(() => null) : null;

    if (count < threshold) {
      if (existing) await existing.delete().catch(() => {});
      if (post) g.delete(postPath);
      return;
    }
    const payload = buildPost(ctx.t, message, count, emoji);
    if (existing) {
      if (post.count !== count) await existing.edit(payload);
      g.set(postPath, { ...post, count });
      return;
    }
    const sent = await board.send(payload);
    g.set(postPath, { boardMessageId: sent.id, channelId: message.channelId, authorId: message.author.id, count, at: Date.now() });
  });
}

/**
 * Removes the board post of a deleted source message.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {string} messageId
 */
async function removePost(ctx, guild, messageId) {
  const g = ctx.store.guild(guild.id);
  const postPath = [...COLLECTIONS.starboardPosts.split('.'), messageId];
  const post = g.get(postPath, null);
  if (!post) return;
  g.delete(postPath);
  const board = guild.channels.cache.get(setting(g, 'community.starboard.channelId'));
  const msg = board?.isTextBased?.() ? await board.messages.fetch(post.boardMessageId).catch(() => null) : null;
  if (msg) await msg.delete().catch(() => {});
}

/**
 * Shared handler for reaction add/remove events: resolves partials, filters early.
 * @param {object} ctx
 * @param {import('discord.js').MessageReaction} reaction
 */
async function onReaction(ctx, reaction) {
  const guildId = reaction.message?.guildId;
  if (!guildId) return;
  const g = ctx.store.guild(guildId);
  if (!setting(g, 'community.starboard.enabled')) return;
  if (!emojiMatches(reaction.emoji, setting(g, 'community.starboard.emoji'))) return;
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild || !message.author) return;
  await sync(ctx, message);
}

module.exports = { parseEmoji, emojiMatches, routeEmoji, fetchStarUsers, countStars, firstImage, buildPost, sync, removePost, onReaction };
