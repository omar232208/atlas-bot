'use strict';

const { PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createCooldowns } = require('../../../core/cooldown');
const { setting, COLLECTIONS } = require('./config');
const { NS, fill, clip, serial } = require('./util');
const { limiter } = require('./stats');

const PREFIX = 'cmtv:';
const MAX_HUBS = 5;
const CREATE_COOLDOWN = 10000;
const creations = createCooldowns();

/** Permissions the bot needs on the hub's category to run temp channels. */
// ManageRoles is required to edit channel overwrites (lock / hide / permit).
const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect];

const tempPath = (id) => [...COLLECTIONS.tempChannels.split('.'), id];
const hubPath = (id) => [...COLLECTIONS.hubs.split('.'), id];

/**
 * Name of a new temporary channel from the guild template.
 * @param {string} template
 * @param {string} displayName
 */
const channelName = (template, displayName) => clip(fill(template, { user: displayName }), 100) || clip(displayName, 100);

/**
 * Reads the temp channel record, or null.
 * @param {object} ctx
 * @param {string} guildId
 * @param {string} channelId
 */
const getTemp = (ctx, guildId, channelId) => ctx.store.guild(guildId).get(tempPath(channelId), null);

/**
 * Control panel posted in the voice channel's chat.
 * @param {Function} t
 * @param {*} lang
 * @param {string} channelId
 * @param {string} ownerId
 */
function panel(t, lang, channelId, ownerId) {
  const btn = (action, style) => new ButtonBuilder().setCustomId(`${PREFIX}${action}:${channelId}`).setStyle(style).setLabel(t(lang, `${NS}:tempvoice.buttons.${action}`));
  const embed = require('../../../core/embeds').base({
    title: t(lang, `${NS}:tempvoice.panelTitle`),
    description: t(lang, `${NS}:tempvoice.panelDesc`, { owner: `<@${ownerId}>` })
  });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(btn('rename', ButtonStyle.Secondary), btn('limit', ButtonStyle.Secondary), btn('lock', ButtonStyle.Secondary), btn('hide', ButtonStyle.Secondary)),
      new ActionRowBuilder().addComponents(btn('permit', ButtonStyle.Success), btn('kick', ButtonStyle.Danger), btn('claim', ButtonStyle.Primary))
    ],
    allowedMentions: { parse: [] }
  };
}

/**
 * Overwrites of a new temp channel: the category's ones (so private categories
 * stay private), then the owner and the bot. One entry per id, later wins.
 * @param {import('discord.js').CategoryChannel|null} parent
 * @param {string} ownerId
 * @param {string} botId
 */
function overwritesFor(parent, ownerId, botId) {
  const byId = new Map();
  for (const ow of parent?.permissionOverwrites?.cache?.values() || []) byId.set(ow.id, { id: ow.id, type: ow.type, allow: ow.allow.bitfield, deny: ow.deny.bitfield });
  const P = PermissionFlagsBits;
  byId.set(ownerId, { id: ownerId, type: 1, allow: P.ViewChannel | P.Connect, deny: 0n });
  byId.set(botId, { id: botId, type: 1, allow: P.ViewChannel | P.Connect | P.ManageChannels | P.MoveMembers | P.SendMessages | P.EmbedLinks, deny: 0n });
  return [...byId.values()];
}

/**
 * Creates a temporary channel for a member who joined a hub, then moves them in.
 * A member who already owns one is sent back to it instead of getting a second.
 * @param {object} ctx
 * @param {import('discord.js').VoiceState} state
 * @param {{categoryId?: string|null}} hub
 */
async function createFor(ctx, state, hub) {
  const { guild, member } = state;
  const g = ctx.store.guild(guild.id);
  const owned = Object.entries(g.get(COLLECTIONS.tempChannels, {})).find(([, rec]) => rec.ownerId === member.id);
  const ownedChannel = owned && guild.channels.cache.get(owned[0]);
  if (ownedChannel) return member.voice.setChannel(ownedChannel).catch(() => {});
  if (creations.hit(`${guild.id}:${member.id}`, CREATE_COOLDOWN) > 0) return member.voice.disconnect().catch(() => {});

  const hubChannel = state.channel;
  const parent = hub.categoryId || hubChannel.parentId || null;
  const parentChannel = parent ? guild.channels.cache.get(parent) : null;
  if (ctx.permissions.botMissing(guild, NEEDED, parentChannel || undefined).length) {
    ctx.logger.warn(`[community] tempvoice: missing permissions in ${guild.id}`);
    return null;
  }
  const template = setting(g, 'community.tempvoice.nameTemplate') || ctx.t(guild, `${NS}:tempvoice.defaultName`);
  const limit = Math.min(99, Math.max(0, Number(setting(g, 'community.tempvoice.defaultLimit')) || 0));
  const channel = await guild.channels.create({
    name: channelName(template, member.displayName),
    type: ChannelType.GuildVoice,
    parent: parent || undefined,
    userLimit: limit,
    bitrate: Math.min(hubChannel.bitrate || 64000, guild.maximumBitrate || 96000),
    permissionOverwrites: overwritesFor(parentChannel, member.id, ctx.client.user.id),
    reason: ctx.t(guild, `${NS}:tempvoice.auditCreate`, { user: member.user.username })
  });
  g.set(tempPath(channel.id), { ownerId: member.id, hubId: hubChannel.id, createdAt: Date.now(), locked: false, hidden: false });
  limiter.record(channel.id);
  const moved = await member.voice.setChannel(channel).then(() => true).catch(() => false);
  if (!moved) return removeIfEmpty(ctx, channel);
  await channel.send(panel(ctx.t, guild, channel.id, member.id)).catch(() => {});
  return channel;
}

/**
 * Deletes a temporary channel once nobody is left in it.
 * @param {object} ctx
 * @param {import('discord.js').VoiceChannel} channel
 */
async function removeIfEmpty(ctx, channel) {
  if (!channel || channel.members.size > 0) return false;
  ctx.store.guild(channel.guild.id).delete(tempPath(channel.id));
  limiter.forget(channel.id);
  await channel.delete(ctx.t(channel.guild, `${NS}:tempvoice.auditDelete`)).catch(() => {});
  return true;
}

/**
 * voiceStateUpdate hook. Serialised per member so fast hub hopping cannot
 * create several channels at once.
 * @param {object} ctx
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
function onVoice(ctx, oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const g = ctx.store.guild(guild.id);
  const hubs = g.get(COLLECTIONS.hubs, {});
  const temps = g.get(COLLECTIONS.tempChannels, {});
  if (!Object.keys(hubs).length && !Object.keys(temps).length) return Promise.resolve();
  return serial(`tv:${guild.id}:${newState.id}`, async () => {
    if (oldState.channelId && oldState.channelId !== newState.channelId && temps[oldState.channelId]) {
      const old = guild.channels.cache.get(oldState.channelId);
      if (old) await removeIfEmpty(ctx, old);
    }
    if (newState.channelId && newState.channelId !== oldState.channelId && hubs[newState.channelId] && newState.member && !newState.member.user.bot) {
      await createFor(ctx, newState, hubs[newState.channelId]);
    }
  });
}

/**
 * Startup cleanup: forget deleted channels and remove those emptied while offline.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 */
async function cleanup(ctx, guild) {
  const g = ctx.store.guild(guild.id);
  for (const id of Object.keys(g.get(COLLECTIONS.tempChannels, {}))) {
    const channel = guild.channels.cache.get(id);
    if (!channel) g.delete(tempPath(id));
    else await removeIfEmpty(ctx, channel);
  }
  for (const id of Object.keys(g.get(COLLECTIONS.hubs, {}))) {
    if (!guild.channels.cache.has(id)) g.delete(hubPath(id));
  }
}

module.exports = { PREFIX, MAX_HUBS, NEEDED, overwritesFor, tempPath, hubPath, channelName, getTemp, panel, createFor, removeIfEmpty, onVoice, cleanup };
