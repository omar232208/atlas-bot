'use strict';

const { ChannelType } = require('discord.js');
const { mapOverwrites } = require('./snapshot');

const VOICE = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

/**
 * Plans which existing roles/channels a replace-mode load deletes. Pure (tested).
 * Never touches @everyone, integration roles, roles at or above the bot, or the
 * channel the command was run in (so progress stays visible).
 * @param {{roles: Array<{id: string, managed?: boolean, position: number}>, channels: Array<{id: string}>, guildId: string, botTop: number, keepChannelId?: string}} input
 * @returns {{roles: string[], channels: string[]}}
 */
function planDeletion(input) {
  return {
    roles: input.roles.filter((r) => r.id !== input.guildId && !r.managed && r.position < input.botTop).map((r) => r.id),
    channels: input.channels.filter((c) => c.id !== input.keepChannelId).map((c) => c.id)
  };
}

/** Number of steps reported to the progress callback. */
function countSteps(data, deletion) {
  return (deletion ? deletion.roles.length + deletion.channels.length : 0) + 1 + data.roles.length + data.channels.length + 1;
}

/**
 * Loads a snapshot into a guild.
 * @param {import('discord.js').Guild} guild
 * @param {object} data Snapshot from serialize().
 * @param {{mode: 'replace'|'merge', keepChannelId?: string, reason: string, onProgress?: (done: number, total: number, phase: string) => any}} opts
 * @returns {Promise<{rolesCreated: number, rolesUpdated: number, channelsCreated: number, channelsUpdated: number, deleted: number, errors: number}>}
 */
async function restore(guild, data, opts) {
  const { mode, reason, keepChannelId } = opts;
  const result = { rolesCreated: 0, rolesUpdated: 0, channelsCreated: 0, channelsUpdated: 0, deleted: 0, errors: 0 };
  const me = guild.members.me;
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);

  const deletion = mode === 'replace'
    ? planDeletion({
      roles: [...guild.roles.cache.values()],
      channels: [...guild.channels.cache.values()].filter((c) => !c.isThread?.()),
      guildId: guild.id,
      botTop: me.roles.highest.position,
      keepChannelId
    })
    : null;
  const total = countSteps(data, deletion);
  let done = 0;
  const step = async (phase) => {
    done++;
    if (opts.onProgress) await opts.onProgress(done, total, phase);
  };
  const attempt = async (fn) => {
    try {
      return await fn();
    } catch {
      result.errors++;
      return null;
    }
  };

  if (deletion) {
    for (const id of deletion.channels) {
      if (await attempt(() => guild.channels.cache.get(id)?.delete(reason))) result.deleted++;
      await step('delete');
    }
    for (const id of deletion.roles) {
      if (await attempt(() => guild.roles.cache.get(id)?.delete(reason))) result.deleted++;
      await step('delete');
    }
  }

  // Server settings. The icon is a CDN URL that may have expired: tried on its own.
  await attempt(() => guild.edit({
    name: data.guild.name,
    verificationLevel: data.guild.verificationLevel,
    explicitContentFilter: data.guild.explicitContentFilter,
    defaultMessageNotifications: data.guild.defaultMessageNotifications,
    afkTimeout: data.guild.afkTimeout,
    reason
  }));
  if (data.guild.iconURL) await attempt(() => guild.setIcon(data.guild.iconURL, reason));
  await attempt(() => guild.roles.everyone.setPermissions(BigInt(data.guild.everyonePermissions), reason));
  await step('settings');

  // Roles are created from the highest down: each new role lands just above
  // @everyone, pushing the previous ones up, so the final order matches.
  const roleMap = new Map([[data.guild.id, guild.id]]);
  const existing = mode === 'merge' ? [...guild.roles.cache.values()].filter((r) => !r.managed && r.id !== guild.id) : [];
  const botTop = me.roles.highest.position;
  for (const r of data.roles) {
    const settings = { name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: BigInt(r.permissions), reason };
    const match = existing.find((e) => e.name === r.name && e.position < botTop);
    if (match) {
      if (await attempt(() => match.edit(settings))) result.rolesUpdated++;
      roleMap.set(r.key, match.id);
    } else {
      const role = await attempt(() => guild.roles.create(settings));
      if (role) { result.rolesCreated++; roleMap.set(r.key, role.id); }
    }
    await step('roles');
  }

  const hasMember = (id) => guild.members.cache.has(id);
  const channelMap = new Map();
  const ordered = [...data.channels].sort((a, b) => (a.type === ChannelType.GuildCategory ? 0 : 1) - (b.type === ChannelType.GuildCategory ? 0 : 1) || a.position - b.position);
  for (const c of ordered) {
    const options = {
      name: c.name,
      type: c.type,
      parent: c.parentKey ? channelMap.get(c.parentKey) || null : null,
      permissionOverwrites: mapOverwrites(c.overwrites, { roleMap, hasMember }),
      reason
    };
    if (!VOICE.has(c.type) && c.type !== ChannelType.GuildCategory) {
      if (c.topic) options.topic = c.topic;
      options.nsfw = c.nsfw;
      options.rateLimitPerUser = c.rateLimitPerUser;
    }
    if (VOICE.has(c.type)) {
      // The bitrate cap depends on the boost level of the target server.
      if (c.bitrate) options.bitrate = Math.min(c.bitrate, guild.maximumBitrate || 96000);
      options.userLimit = c.userLimit;
    }
    const match = mode === 'merge'
      ? guild.channels.cache.find((e) => e.name === c.name && e.type === c.type && (e.parentId || null) === (options.parent || null))
      : null;
    let channel = null;
    if (match) {
      const { type, ...edit } = options;
      channel = await attempt(() => match.edit({ ...edit, lockPermissions: false }));
      if (channel) result.channelsUpdated++;
    } else {
      channel = await attempt(() => guild.channels.create(options));
      // Announcement and forum channels need a Community server: fall back to a text channel.
      if (!channel && (c.type === ChannelType.GuildAnnouncement || c.type === ChannelType.GuildForum)) {
        result.errors--;
        channel = await attempt(() => guild.channels.create({ ...options, type: ChannelType.GuildText }));
      }
      if (channel) result.channelsCreated++;
    }
    if (channel) channelMap.set(c.key, channel.id);
    await step('channels');
  }

  const afk = data.guild.afkChannelKey && channelMap.get(data.guild.afkChannelKey);
  const system = data.guild.systemChannelKey && channelMap.get(data.guild.systemChannelKey);
  if (afk || system) await attempt(() => guild.edit({ ...(afk ? { afkChannel: afk } : {}), ...(system ? { systemChannel: system } : {}), reason }));
  await step('finish');
  return result;
}

module.exports = { restore, planDeletion, countSteps };
