'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { lockedOverwrite, overwriteOptions } = require('./logic');

const STATE = 'antiraid.lockdown';

// Channel kinds whose @everyone overwrite matters for members talking or joining.
const LOCKABLE = new Set([
  ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice,
  ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia
]);

/**
 * Current lockdown state of a guild, or null.
 * @param {object} store
 * @param {string} guildId
 * @returns {{active: boolean, at: number, by: string, reason: string, auto: boolean, channels: Record<string, {allow: string, deny: string}|null>}|null}
 */
function getLockdown(store, guildId) {
  const s = store.guild(guildId).get(STATE, null);
  return s?.active ? s : null;
}

/**
 * Channels a lockdown should touch: talkable channels that @everyone can see and
 * where the bot may edit overwrites. Private channels are left alone so staff
 * keep working normally.
 * @param {import('discord.js').Guild} guild
 */
function lockTargets(guild) {
  const me = guild.members.me;
  const everyone = guild.roles.everyone;
  return [...guild.channels.cache.values()].filter((c) => LOCKABLE.has(c.type)
    && c.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel)
    && c.permissionsFor(me)?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles]));
}

/**
 * Locks every target channel. The previous @everyone overwrites are saved
 * before any edit so a crash halfway still leaves a restorable state.
 * @param {import('discord.js').Guild} guild
 * @param {object} store
 * @param {{by: string, reason: string, auto?: boolean, onLocked?: (channel) => Promise<any>}} opts
 * @returns {Promise<{locked: number, failed: number, already?: boolean}>}
 */
async function startLockdown(guild, store, opts) {
  if (getLockdown(store, guild.id)) return { locked: 0, failed: 0, already: true };
  const everyoneId = guild.roles.everyone.id;
  const targets = lockTargets(guild);
  const channels = {};
  for (const c of targets) {
    const ow = c.permissionOverwrites.cache.get(everyoneId);
    channels[c.id] = ow ? { allow: ow.allow.bitfield.toString(), deny: ow.deny.bitfield.toString() } : null;
  }
  store.guild(guild.id).set(STATE, { active: true, at: Date.now(), by: opts.by, reason: opts.reason || '', auto: !!opts.auto, channels });
  let locked = 0;
  let failed = 0;
  for (const c of targets) {
    const next = lockedOverwrite(channels[c.id]);
    try {
      await c.permissionOverwrites.create(everyoneId, overwriteOptions(next.allow, next.deny), { reason: opts.reason || 'Lockdown' });
      locked++;
      if (opts.onLocked) await opts.onLocked(c).catch(() => {});
    } catch {
      failed++;
    }
  }
  return { locked, failed };
}

/**
 * Restores every saved overwrite exactly as it was (deleting the @everyone
 * overwrite when there was none before).
 * @param {import('discord.js').Guild} guild
 * @param {object} store
 * @param {string} [reason]
 * @returns {Promise<{restored: number, failed: number, missing: number, notActive?: boolean}>}
 */
async function endLockdown(guild, store, reason) {
  const state = getLockdown(store, guild.id);
  if (!state) return { restored: 0, failed: 0, missing: 0, notActive: true };
  const everyoneId = guild.roles.everyone.id;
  let restored = 0;
  let failed = 0;
  let missing = 0;
  const left = {};
  for (const [id, prev] of Object.entries(state.channels || {})) {
    const c = guild.channels.cache.get(id);
    if (!c) { missing++; continue; }
    try {
      if (prev) await c.permissionOverwrites.create(everyoneId, overwriteOptions(prev.allow, prev.deny), { reason: reason || 'Lockdown end' });
      else await c.permissionOverwrites.delete(everyoneId, reason || 'Lockdown end');
      restored++;
    } catch {
      failed++;
      left[id] = prev;
    }
  }
  // Keep the channels that could not be restored so a second /lockdown end can retry them.
  if (failed) store.guild(guild.id).set(STATE, { ...state, channels: left });
  else store.guild(guild.id).delete(STATE);
  return { restored, failed, missing };
}

module.exports = { getLockdown, lockTargets, startLockdown, endLockdown, LOCKABLE };
