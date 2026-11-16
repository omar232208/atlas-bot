'use strict';

const { MessageFlags } = require('discord.js');
const { setting, COLLECTIONS } = require('./config');
const { NS, fail, apiError, serial } = require('./util');
const S = require('./suggestions');

/**
 * Reads one stored suggestion by number.
 * @param {object} ctx
 * @param {string} guildId
 * @param {number} number
 */
const getItem = (ctx, guildId, number) => ctx.store.guild(guildId).get([...COLLECTIONS.suggestions.split('.'), String(number)], null);

/** Saves a suggestion (always a fresh object, never a mutated store reference). */
const saveItem = (ctx, guildId, item) => ctx.store.guild(guildId).set([...COLLECTIONS.suggestions.split('.'), String(item.number)], item);

/** Removes a suggestion from the store. */
const deleteItem = (ctx, guildId, number) => ctx.store.guild(guildId).delete([...COLLECTIONS.suggestions.split('.'), String(number)]);

/**
 * Builds the message payload (embed + buttons) of a suggestion.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {object} item
 */
async function render(ctx, guild, item) {
  const anonymous = item.anonymous ?? setting(ctx.store.guild(guild.id), 'community.suggestions.anonymous');
  const user = anonymous ? null : await ctx.client.users.fetch(item.authorId).catch(() => null);
  const view = { anonymous, authorTag: user?.username, avatar: user?.displayAvatarURL?.({ size: 128 }) };
  return { embeds: [S.buildEmbed(ctx.t, guild, item, view)], components: S.buildButtons(ctx.t, guild, item), allowedMentions: { parse: [] } };
}

/**
 * Fetches the public message of a suggestion, or null when it was deleted.
 * @param {import('discord.js').Guild} guild
 * @param {object} item
 */
async function fetchMessage(guild, item) {
  const channel = guild.channels.cache.get(item.channelId) || await guild.channels.fetch(item.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel.messages.fetch(item.messageId).catch(() => null);
}

/**
 * Re-renders the public message after a status change.
 * @returns {Promise<boolean>} false when the message no longer exists.
 */
async function refreshMessage(ctx, guild, item) {
  const message = await fetchMessage(guild, item);
  if (!message) return false;
  await message.edit(await render(ctx, guild, item));
  // Closing the thread keeps the discussion readable but stops it once decided.
  if (S.isLocked(item.status) && message.thread && !message.thread.archived) {
    await message.thread.setLocked(true).catch(() => {});
    await message.thread.setArchived(true).catch(() => {});
  }
  return true;
}

/**
 * Tells the author their suggestion was answered. DMs closed are common, so failures are silent.
 */
async function notifyAuthor(ctx, guild, item, url) {
  if (!setting(ctx.store.guild(guild.id), 'community.suggestions.dmUpdates')) return;
  const user = await ctx.client.users.fetch(item.authorId).catch(() => null);
  if (!user) return;
  const embed = ctx.embeds.info(
    ctx.t(guild, `${NS}:suggestions.dm.title`, { number: item.number, server: guild.name }),
    ctx.t(guild, `${NS}:suggestions.dm.body`, {
      status: ctx.t(guild, `${NS}:suggestions.status.${item.status}`),
      reason: item.reason || ctx.t(guild, `${NS}:suggestions.noReason`),
      url: url || '-'
    })
  );
  await user.send({ embeds: [embed] }).catch(() => {});
}

/**
 * Button handler for votes ("cmsug:up:<n>" / "cmsug:down:<n>").
 * Votes are serialised per suggestion so two quick clicks cannot lose a vote.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 */
async function handleVote(interaction, ctx) {
  const parsed = S.parseVoteId(interaction.customId);
  if (!parsed || !interaction.guild) return fail(interaction, ctx, 'errors.expired');
  return serial(`sug:${interaction.guildId}:${parsed.number}`, async () => {
    const item = getItem(ctx, interaction.guildId, parsed.number);
    if (!item) return fail(interaction, ctx, 'suggestions.notFound', { number: parsed.number });
    if (S.isLocked(item.status)) return fail(interaction, ctx, 'suggestions.closed');
    const { up, down, action } = S.applyVote(item, interaction.user.id, parsed.side);
    const next = { ...item, up, down };
    saveItem(ctx, interaction.guildId, next);
    try {
      await interaction.update(await render(ctx, interaction.guild, next));
    } catch (err) {
      return apiError(interaction, ctx, err);
    }
    const key = action === 'removed' ? 'suggestions.voteRemoved' : 'suggestions.voteSaved';
    await interaction.followUp({
      embeds: [ctx.embeds.success(ctx.t(interaction, `${NS}:${key}`, { side: ctx.t(interaction, `${NS}:suggestions.side.${parsed.side}`) }))],
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return null;
  });
}

module.exports = { getItem, saveItem, deleteItem, render, fetchMessage, refreshMessage, notifyAuthor, handleVote };
