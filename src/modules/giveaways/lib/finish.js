'use strict';

const { pickWinners, getConfig } = require('./logic');
const { giveawayEmbed, enterRow } = require('./render');

const itemKey = (id) => `giveaways.items.${id}`;

/** Loads a giveaway record, or null. */
function load(ctx, guildId, id) {
  return ctx.store.guild(guildId).get(itemKey(id)) || null;
}

/** Saves a changed record. */
function save(ctx, guildId, record) {
  ctx.store.guild(guildId).set(itemKey(record.id), record);
  return record;
}

/**
 * Edits the giveaway message to its current state. Failures (message or
 * channel deleted) are logged, never thrown: the result is still settled.
 */
async function refreshMessage(ctx, client, record) {
  try {
    const channel = await client.channels.fetch(record.channelId);
    const message = await channel.messages.fetch(record.messageId);
    await message.edit({ embeds: [giveawayEmbed(ctx, { guildId: record.guildId }, record)], components: [enterRow(ctx, { guildId: record.guildId }, record)] });
    return channel;
  } catch (err) {
    ctx.logger.warn(`giveaway ${record.id}: could not edit its message:`, err.message);
    return null;
  }
}

/** Sends the winners' announcement and, optionally, a DM to each winner. */
async function announce(ctx, client, record, winnerIds, channel) {
  const target = { guildId: record.guildId };
  if (channel) {
    const text = winnerIds.length
      ? ctx.t(target, 'giveaways:ended.announce', { prize: record.prize, winners: winnerIds.map((id) => `<@${id}>`).join(' ') })
      : ctx.t(target, 'giveaways:ended.noWinners', { prize: record.prize });
    await channel.send({ content: winnerIds.map((id) => `<@${id}>`).join(' ') || undefined, embeds: [ctx.embeds.info(text)] }).catch(() => {});
  }
  if (!getConfig(ctx.store, record.guildId).dmWinners) return;
  for (const id of winnerIds) {
    const user = await client.users.fetch(id).catch(() => null);
    await user?.send({ embeds: [ctx.embeds.success(ctx.t(target, 'giveaways:ended.dmTitle'), ctx.t(target, 'giveaways:ended.dm', { prize: record.prize }))] }).catch(() => {});
  }
}

/**
 * Ends an active giveaway: draws the winners, saves them, updates the message
 * and announces. Returns the settled record, or null if it was not active.
 * @param {object} ctx
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} id
 */
async function endGiveaway(ctx, client, guildId, id) {
  const record = load(ctx, guildId, id);
  if (!record || record.status !== 'active') return null;
  if (record.jobId) ctx.scheduler.cancel(record.jobId);
  const winnerIds = pickWinners(Object.keys(record.entries), record.winnersCount, Math.random);
  const settled = save(ctx, guildId, { ...record, status: 'ended', winnerIds, jobId: null });
  const channel = await refreshMessage(ctx, client, settled);
  await announce(ctx, client, settled, winnerIds, channel);
  return settled;
}

/**
 * Draws a new set of winners for an ended giveaway, never repeating the
 * previous winners while there are other entries. Returns the record, or
 * null when there is nobody else to draw.
 */
async function rerollGiveaway(ctx, client, guildId, id) {
  const record = load(ctx, guildId, id);
  if (!record || record.status !== 'ended') return null;
  const winnerIds = pickWinners(Object.keys(record.entries), record.winnersCount, Math.random, record.winnerIds);
  if (!winnerIds.length) return { noAlternative: true };
  const settled = save(ctx, guildId, { ...record, winnerIds });
  const channel = await refreshMessage(ctx, client, settled);
  await announce(ctx, client, settled, winnerIds, channel);
  return settled;
}

/**
 * Cancels an active giveaway without winners.
 * @returns {Promise<object|null>}
 */
async function cancelGiveaway(ctx, client, guildId, id) {
  const record = load(ctx, guildId, id);
  if (!record || record.status !== 'active') return null;
  if (record.jobId) ctx.scheduler.cancel(record.jobId);
  const settled = save(ctx, guildId, { ...record, status: 'cancelled', winnerIds: [], jobId: null });
  await refreshMessage(ctx, client, settled);
  return settled;
}

module.exports = { load, save, endGiveaway, rerollGiveaway, cancelGiveaway, itemKey };
