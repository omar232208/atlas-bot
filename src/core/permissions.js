'use strict';

const { PermissionsBitField } = require('discord.js');

const ownerIds = () => (process.env.OWNER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Guild owner or listed in OWNER_IDS.
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
function isOwner(guild, userId) {
  return ownerIds().includes(userId) || (!!guild && guild.ownerId === userId);
}

/**
 * Owner, or added with /whitelist (stored under the guild key "whitelist", an array of user IDs).
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
function isWhitelisted(guild, userId) {
  if (isOwner(guild, userId)) return true;
  if (!guild) return false;
  const list = require('./store').guild(guild.id).get('whitelist', []);
  return Array.isArray(list) && list.includes(userId);
}

/**
 * Whether `moderator` may act on `target` according to Discord role hierarchy:
 * nobody acts on the guild owner or on themselves; the owner acts on everyone else;
 * otherwise the moderator's highest role must be strictly above the target's.
 * Works with any objects shaped like GuildMember ({ id, guild.ownerId, roles.highest.position }).
 * @param {import('discord.js').GuildMember} moderator
 * @param {import('discord.js').GuildMember} target
 * @returns {boolean}
 */
function canModerate(moderator, target) {
  if (!moderator || !target) return false;
  if (moderator.id === target.id) return false;
  const ownerId = target.guild?.ownerId ?? moderator.guild?.ownerId;
  if (target.id === ownerId) return false;
  if (moderator.id === ownerId) return true;
  return (moderator.roles?.highest?.position ?? 0) > (target.roles?.highest?.position ?? 0);
}

/**
 * Whether the bot itself has a permission in the guild (or in a channel if given).
 * @param {import('discord.js').Guild} guild
 * @param {bigint|string} perm A PermissionFlagsBits value or flag name.
 * @param {import('discord.js').GuildChannel} [channel]
 */
function botCan(guild, perm, channel) {
  const me = guild?.members?.me;
  if (!me) return false;
  const perms = channel ? channel.permissionsFor(me) : me.permissions;
  return !!perms && perms.has(perm);
}

/**
 * Lists the flag names (e.g. "BanMembers") the bot lacks among `perms`.
 * @param {import('discord.js').Guild} guild
 * @param {Array<bigint|string>} perms
 * @param {import('discord.js').GuildChannel} [channel]
 * @returns {string[]}
 */
function botMissing(guild, perms, channel) {
  return perms.filter((p) => !botCan(guild, p, channel)).map((p) => (typeof p === 'string' ? p : new PermissionsBitField(p).toArray()[0]));
}

/**
 * Localized, human-readable name of a permission (key common:permissions.<FlagName>),
 * falling back to the flag name so an unknown flag still reads sensibly.
 * @param {*} target Language target accepted by t() (code, interaction, guild).
 * @param {bigint|string} perm
 * @returns {string}
 */
function permissionLabel(target, perm) {
  const name = typeof perm === 'string' ? perm : new PermissionsBitField(perm).toArray()[0];
  const i18n = require('./i18n');
  const key = `common:permissions.${name}`;
  const value = i18n.t(target, key);
  return value === key ? String(name) : value;
}

module.exports = { isOwner, isWhitelisted, canModerate, botCan, botMissing, ownerIds, permissionLabel };
