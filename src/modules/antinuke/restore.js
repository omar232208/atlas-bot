'use strict';

const { ChannelType, Routes, StickerFormatType, PermissionsBitField } = require('discord.js');
const { channelCreateOptions, roleCreateOptions, revertedPermissions, guildRevert } = require('./logic');
const { orphans } = require('./memory');

// Re-adding a restored role to thousands of members would hit rate limits for
// minutes; the most recent members are restored and the rest is reported.
const MAX_ROLE_MEMBERS = 250;

/**
 * Re-creates a deleted channel with its settings, overwrites and position.
 * A deleted category also gets its former channels moved back inside.
 * @param {import('discord.js').Guild} guild
 * @param {object} snap channelSnapshot()
 * @returns {Promise<import('discord.js').GuildChannel>}
 */
async function restoreChannel(guild, snap, reason) {
  const exists = (id) => id === guild.id || guild.roles.cache.has(id) || guild.members.cache.has(id);
  const parentExists = (id) => guild.channels.cache.get(id)?.type === ChannelType.GuildCategory;
  const opts = channelCreateOptions(snap, { exists, parentExists, maxBitrate: guild.maximumBitrate });
  const channel = await guild.channels.create({ ...opts, reason });
  if (snap.type === ChannelType.GuildCategory) {
    const children = new Set(orphans.valuesWithPrefix(`${guild.id}:${snap.id}:`));
    for (const c of guild.channels.cache.values()) if (c.parentId === snap.id) children.add(c.id);
    for (const id of children) {
      const child = guild.channels.cache.get(id);
      if (child && child.id !== channel.id) await child.setParent(channel.id, { lockPermissions: false, reason }).catch(() => {});
    }
  }
  return channel;
}

/**
 * Re-creates a deleted role, gives it back to its members and re-applies the
 * channel overwrites that referenced it.
 * @param {import('discord.js').Guild} guild
 * @param {object} snap roleSnapshot()
 * @returns {Promise<{role: import('discord.js').Role, members: number, skipped: number}>}
 */
async function restoreRole(guild, snap, reason) {
  const role = await guild.roles.create({ ...roleCreateOptions(snap, guild.members.me.roles.highest.position), reason });
  for (const o of snap.overwrites || []) {
    const c = guild.channels.cache.get(o.channelId);
    if (c) await c.permissionOverwrites.create(role.id, bitsToOptions(o.allow, o.deny), { reason }).catch(() => {});
  }
  let members = 0;
  const ids = (snap.members || []).slice(-MAX_ROLE_MEMBERS);
  for (const id of ids) {
    const m = guild.members.cache.get(id);
    if (m && await m.roles.add(role.id, reason).then(() => true).catch(() => false)) members++;
  }
  return { role, members, skipped: Math.max(0, (snap.members || []).length - ids.length) };
}

// PermissionOverwriteManager#create wants { Flag: true|false }, not raw bitfields.
function bitsToOptions(allow, deny) {
  const out = {};
  for (const n of new PermissionsBitField(BigInt(allow)).toArray()) out[n] = true;
  for (const n of new PermissionsBitField(BigInt(deny)).toArray()) out[n] = false;
  return out;
}

/**
 * Undoes one tracked action. Each tracked item is { action, targetId, data }.
 * Returns true when something was actually undone.
 * @param {import('discord.js').Guild} guild
 * @param {{action: string, targetId: string, data?: any}} item
 * @param {string} reason Audit log reason.
 */
async function undo(guild, item, reason) {
  const { action, targetId, data } = item;
  switch (action) {
    case 'channelDelete':
      if (!data) return false;
      await restoreChannel(guild, data, reason);
      return true;
    case 'channelCreate': {
      const c = guild.channels.cache.get(targetId);
      if (!c) return false;
      await c.delete(reason);
      return true;
    }
    case 'roleDelete':
      if (!data) return false;
      await restoreRole(guild, data, reason);
      return true;
    case 'roleCreate': {
      const r = guild.roles.cache.get(targetId);
      if (!r || !r.editable) return false;
      await r.delete(reason);
      return true;
    }
    case 'rolePermGrant': {
      const r = guild.roles.cache.get(targetId);
      if (!r || !r.editable) return false;
      await r.setPermissions(revertedPermissions(data.old, r.permissions.bitfield), reason);
      return true;
    }
    case 'memberRoleGrant': {
      const m = await guild.members.fetch(targetId).catch(() => null);
      const roles = (data.roleIds || []).filter((id) => guild.roles.cache.get(id)?.editable);
      if (!m || !roles.length) return false;
      await m.roles.remove(roles, reason);
      return true;
    }
    case 'ban':
      await guild.members.unban(targetId, reason);
      return true;
    case 'webhookCreate': {
      const hook = await guild.client.fetchWebhook(targetId).catch(() => null);
      if (!hook) return false;
      await hook.delete(reason);
      return true;
    }
    case 'guildUpdate':
    case 'vanity': {
      const { edit, vanity } = guildRevert(data.changes, guild.id);
      if (Object.keys(edit).length) await guild.edit({ ...edit, reason });
      // The vanity endpoint is restricted; this works for servers allowed to set one and fails quietly otherwise.
      if (action === 'vanity' && vanity) await guild.client.rest.patch(Routes.guildVanityUrl(guild.id), { body: { code: vanity }, reason });
      return true;
    }
    case 'emojiDelete':
      if (!data?.url) return false;
      await guild.emojis.create({ attachment: data.url, name: data.name, reason });
      return true;
    case 'stickerDelete':
      // Lottie stickers can only be uploaded by Discord partners.
      if (!data?.url || data.format === StickerFormatType.Lottie) return false;
      await guild.stickers.create({ file: data.url, name: data.name, tags: data.tags || data.name, description: data.description || '', reason });
      return true;
    default:
      return false;
  }
}

module.exports = { undo, restoreChannel, restoreRole, MAX_ROLE_MEMBERS };
