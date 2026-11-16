'use strict';

const { DATA } = require('./config');

const TEXT_PERMS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions'];
const VOICE_PERMS = ['Connect', 'SendMessages'];

/**
 * Permissions a lock denies to @everyone, depending on the channel kind.
 * @param {{isVoiceBased?: () => boolean}} channel
 */
function lockPerms(channel) {
  return typeof channel.isVoiceBased === 'function' && channel.isVoiceBased() ? VOICE_PERMS : TEXT_PERMS;
}

/**
 * Reads the current @everyone state of each permission: true (allowed),
 * false (denied) or null (inherited). Saved so /unlock restores it exactly.
 * @param {{allow?: {has: Function}, deny?: {has: Function}}|undefined} overwrite
 * @param {string[]} perms
 */
function snapshot(overwrite, perms) {
  const out = {};
  for (const p of perms) out[p] = overwrite?.allow?.has(p) ? true : overwrite?.deny?.has(p) ? false : null;
  return out;
}

/**
 * Locks a channel for @everyone and remembers the previous state.
 * @param {import('discord.js').GuildChannel} channel
 * @param {object} gs Guild store handle.
 * @param {string} auditReason
 * @returns {Promise<boolean>} false when the channel was already locked by the bot.
 */
async function lockChannel(channel, gs, auditReason) {
  const key = `${DATA.locks}.${channel.id}`;
  if (gs.get(key)) return false;
  const perms = lockPerms(channel);
  const everyone = channel.guild.roles.everyone.id;
  const before = snapshot(channel.permissionOverwrites.cache.get(everyone), perms);
  await channel.permissionOverwrites.edit(everyone, Object.fromEntries(perms.map((p) => [p, false])), { reason: auditReason });
  gs.set(key, before);
  return true;
}

/**
 * Restores the saved @everyone state. A channel denied by hand (no saved
 * state) is reset to inherited for SendMessages so /unlock still works.
 * @param {import('discord.js').GuildChannel} channel
 * @param {object} gs
 * @param {string} auditReason
 * @returns {Promise<boolean>} false when the channel was not locked.
 */
async function unlockChannel(channel, gs, auditReason) {
  const key = `${DATA.locks}.${channel.id}`;
  const everyone = channel.guild.roles.everyone.id;
  const saved = gs.get(key);
  if (!saved) {
    const current = channel.permissionOverwrites.cache.get(everyone);
    if (!current?.deny?.has('SendMessages')) return false;
    await channel.permissionOverwrites.edit(everyone, { SendMessages: null }, { reason: auditReason });
    return true;
  }
  await channel.permissionOverwrites.edit(everyone, { ...saved }, { reason: auditReason });
  gs.delete(key);
  return true;
}

module.exports = { lockPerms, snapshot, lockChannel, unlockChannel, TEXT_PERMS, VOICE_PERMS };
