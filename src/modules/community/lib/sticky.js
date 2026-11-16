'use strict';

const { PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { setting, COLLECTIONS } = require('./config');
const { NS, clip, serial, fail, ok } = require('./util');

const PREFIX = 'cmsty:';
const MAX_STICKIES = 25;
const timers = new Map();
// Copies the bot deletes itself, so the messageDelete event does not repost them.
const ownDeletes = new Set();

/**
 * Whether a deleted message was removed by the bot itself (consumes the mark).
 * @param {string} messageId
 */
const wasOwnDelete = (messageId) => ownDeletes.delete(messageId);

const stickyPath = (channelId) => [...COLLECTIONS.sticky.split('.'), channelId];

/**
 * Builds the sticky message payload.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {{title?: string, content: string}} sticky
 */
function payload(ctx, guild, sticky) {
  const embed = ctx.embeds.base({ title: sticky.title || undefined, description: clip(sticky.content, 4000), footer: ctx.t(guild, `${NS}:sticky.footer`) });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

/**
 * Deletes the previous copy and posts the sticky again at the bottom.
 * Serialised per channel so overlapping reposts never leave two copies.
 * @param {object} ctx
 * @param {import('discord.js').TextBasedChannel} channel
 */
function repost(ctx, channel) {
  return serial(`sticky:${channel.id}`, async () => {
    const g = ctx.store.guild(channel.guild.id);
    const sticky = g.get(stickyPath(channel.id), null);
    if (!sticky) return;
    if (!ctx.permissions.botCan(channel.guild, PermissionFlagsBits.SendMessages, channel)) return;
    if (sticky.messageId) {
      const old = await channel.messages.fetch(sticky.messageId).catch(() => null);
      if (old) {
        ownDeletes.add(old.id);
        await old.delete().catch(() => ownDeletes.delete(old.id));
      }
    }
    const sent = await channel.send(payload(ctx, channel.guild, sticky));
    // Re-read: the sticky may have been removed while we were sending.
    if (g.get(stickyPath(channel.id), null)) g.set(stickyPath(channel.id), { ...g.get(stickyPath(channel.id)), messageId: sent.id });
    else await sent.delete().catch(() => {});
  });
}

/**
 * Called for every guild message: waits for a quiet moment (configurable delay)
 * before reposting, so a fast conversation causes one repost, not one per message.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 */
function onMessage(ctx, message) {
  if (message.author.id === ctx.client.user?.id) return;
  const g = ctx.store.guild(message.guildId);
  if (!g.get(stickyPath(message.channelId), null)) return;
  clearTimeout(timers.get(message.channelId));
  const delay = Math.min(60, Math.max(2, Number(setting(g, 'community.sticky.delay')) || 5)) * 1000;
  const timer = setTimeout(() => {
    timers.delete(message.channelId);
    repost(ctx, message.channel).catch((err) => ctx.logger.debug(`[community] sticky ${message.channelId}: ${err.message}`));
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(message.channelId, timer);
}

/**
 * The modal used to write the sticky text (multi-line, prefilled when editing).
 * @param {*} lang
 * @param {Function} t
 * @param {string} channelId
 * @param {{title?: string, content?: string}|null} current
 */
function modal(lang, t, channelId, current) {
  const title = new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200)
    .setLabel(t(lang, `${NS}:sticky.modalTitleField`));
  const content = new TextInputBuilder().setCustomId('content').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)
    .setLabel(t(lang, `${NS}:sticky.modalContentField`));
  if (current?.title) title.setValue(current.title);
  if (current?.content) content.setValue(current.content);
  return new ModalBuilder().setCustomId(`${PREFIX}set:${channelId}`).setTitle(t(lang, `${NS}:sticky.modalTitle`))
    .addComponents(new ActionRowBuilder().addComponents(title), new ActionRowBuilder().addComponents(content));
}

/**
 * Modal submit handler ("cmsty:set:<channelId>").
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} ctx
 */
async function handleModal(interaction, ctx) {
  const m = /^cmsty:set:(\d+)$/.exec(interaction.customId);
  if (!m || !interaction.isModalSubmit?.()) return fail(interaction, ctx, 'errors.expired');
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return fail(interaction, ctx, 'errors.memberMissing', { perms: '`ManageMessages`' });
  const channel = interaction.guild.channels.cache.get(m[1]);
  if (!channel?.isTextBased?.()) return fail(interaction, ctx, 'errors.notFound');
  const g = ctx.store.guild(interaction.guildId);
  const all = g.get(COLLECTIONS.sticky, {});
  if (!all[channel.id] && Object.keys(all).length >= MAX_STICKIES) return fail(interaction, ctx, 'sticky.tooMany', { max: MAX_STICKIES });
  const previous = all[channel.id] || {};
  g.set(stickyPath(channel.id), {
    title: interaction.fields.getTextInputValue('title').trim() || null,
    content: interaction.fields.getTextInputValue('content'),
    messageId: previous.messageId || null,
    setBy: interaction.user.id
  });
  await ok(interaction, ctx, 'sticky.saved', null, { channel: `<#${channel.id}>` });
  await repost(ctx, channel).catch((err) => ctx.logger.debug(`[community] sticky first post: ${err.message}`));
  return null;
}

/**
 * Removes the sticky of a channel and its last posted copy.
 * @returns {Promise<boolean>}
 */
async function removeSticky(ctx, guild, channelId) {
  const g = ctx.store.guild(guild.id);
  const sticky = g.get(stickyPath(channelId), null);
  if (!sticky) return false;
  g.delete(stickyPath(channelId));
  clearTimeout(timers.get(channelId));
  timers.delete(channelId);
  const channel = guild.channels.cache.get(channelId);
  if (channel?.isTextBased?.() && sticky.messageId) {
    const msg = await channel.messages.fetch(sticky.messageId).catch(() => null);
    if (msg) await msg.delete().catch(() => {});
  }
  return true;
}

module.exports = { wasOwnDelete, PREFIX, MAX_STICKIES, stickyPath, payload, repost, onMessage, modal, handleModal, removeSticky };
