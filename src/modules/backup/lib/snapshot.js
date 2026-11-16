'use strict';

const { ChannelType, OverwriteType } = require('discord.js');

/** Snapshot format version, stored so a future format change can migrate old backups. */
const VERSION = 1;

/** Channel types a backup can recreate (threads and DMs are not server structure). */
const SUPPORTED = new Set([
  ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory,
  ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum
]);

const values = (collection) => [...(collection?.values?.() || [])];
const bits = (perm) => (perm?.bitfield ?? perm ?? 0n).toString();

/**
 * Converts a guild into a plain JSON snapshot. Original IDs are kept as keys so
 * overwrites and parents can be re-linked to the new IDs when loading.
 * @param {import('discord.js').Guild} guild
 * @returns {object}
 */
function serialize(guild) {
  const roles = values(guild.roles.cache)
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      key: r.id,
      name: r.name,
      color: r.color,
      hoist: !!r.hoist,
      mentionable: !!r.mentionable,
      permissions: bits(r.permissions),
      position: r.position
    }));

  const channels = values(guild.channels.cache)
    .filter((c) => SUPPORTED.has(c.type))
    .sort((a, b) => (a.type === ChannelType.GuildCategory ? 0 : 1) - (b.type === ChannelType.GuildCategory ? 0 : 1) || a.rawPosition - b.rawPosition)
    .map((c) => ({
      key: c.id,
      type: c.type,
      name: c.name,
      parentKey: c.parentId || null,
      position: c.rawPosition ?? c.position ?? 0,
      topic: c.topic || null,
      nsfw: !!c.nsfw,
      rateLimitPerUser: c.rateLimitPerUser || 0,
      bitrate: c.bitrate || null,
      userLimit: c.userLimit || 0,
      overwrites: values(c.permissionOverwrites?.cache).map((o) => ({
        kind: o.type === OverwriteType.Member ? 'member' : 'role',
        id: o.id,
        allow: bits(o.allow),
        deny: bits(o.deny)
      }))
    }));

  return {
    version: VERSION,
    guild: {
      id: guild.id,
      name: guild.name,
      iconURL: typeof guild.iconURL === 'function' ? guild.iconURL({ extension: 'png', size: 512 }) : null,
      verificationLevel: guild.verificationLevel,
      explicitContentFilter: guild.explicitContentFilter,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      afkTimeout: guild.afkTimeout,
      afkChannelKey: guild.afkChannelId || null,
      systemChannelKey: guild.systemChannelId || null,
      everyonePermissions: bits(guild.roles.cache.get(guild.id)?.permissions)
    },
    roles,
    channels
  };
}

/**
 * Counts what a snapshot contains (for list/info/confirmation texts).
 * @param {object} data
 */
function summarize(data) {
  const channels = data.channels || [];
  return {
    roles: (data.roles || []).length,
    categories: channels.filter((c) => c.type === ChannelType.GuildCategory).length,
    text: channels.filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(c.type)).length,
    voice: channels.filter((c) => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type)).length,
    bytes: Buffer.byteLength(JSON.stringify(data))
  };
}

/**
 * Maps stored overwrites to the new IDs. Role overwrites whose role was not
 * restored and member overwrites for people not on the server are dropped,
 * because Discord rejects unknown IDs and would fail the whole channel.
 * @param {Array<{kind: string, id: string, allow: string, deny: string}>} overwrites
 * @param {{roleMap: Map<string, string>, hasMember: (id: string) => boolean}} env
 */
function mapOverwrites(overwrites, env) {
  const out = [];
  for (const o of overwrites || []) {
    if (o.kind === 'member') {
      if (env.hasMember(o.id)) out.push({ id: o.id, type: OverwriteType.Member, allow: BigInt(o.allow), deny: BigInt(o.deny) });
      continue;
    }
    const id = env.roleMap.get(o.id);
    if (id) out.push({ id, type: OverwriteType.Role, allow: BigInt(o.allow), deny: BigInt(o.deny) });
  }
  return out;
}

/**
 * Basic shape check so a corrupted store entry cannot half-load.
 * @param {any} data
 */
function isValid(data) {
  return !!data && data.version === VERSION && !!data.guild && Array.isArray(data.roles) && Array.isArray(data.channels);
}

module.exports = { VERSION, SUPPORTED, serialize, summarize, mapOverwrites, isValid };
