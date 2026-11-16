'use strict';

const { PermissionFlagsBits } = require('discord.js');

/** Every store path this module reads, with its default (the dashboard uses the same). */
const SETTINGS = {
  'verification.enabled': false,
  'verification.roleId': null,
  'verification.unverifiedRoleId': null,
  'verification.channelId': null,
  'verification.messageId': null,
  'verification.kickAfter': 0,
  'verification.codeLength': 6,
  'verification.maxAttempts': 3,
  'verification.panelMessage': ''
};

/** Kick delay bounds: under a minute nobody can verify, over a week it is pointless. */
const KICK_MIN_MS = 60000;
const KICK_MAX_MS = 7 * 86400000;
const KICK_JOB = 'verification:kick';

/**
 * Reads a setting with its default.
 * @param {object} g Guild store handle.
 * @param {keyof SETTINGS} path
 */
function setting(g, path) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS, path)) throw new Error(`verification: unknown setting ${path}`);
  return g.get(path, SETTINGS[path]);
}

/**
 * Why the bot cannot give / remove a role, or null when it can.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @returns {null|'managed'|'everyone'|'hierarchy'|'noPermission'}
 */
function roleProblem(guild, role) {
  if (role.id === guild.id) return 'everyone';
  if (role.managed) return 'managed';
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'noPermission';
  if (role.position >= me.roles.highest.position) return 'hierarchy';
  return null;
}

module.exports = { SETTINGS, KICK_MIN_MS, KICK_MAX_MS, KICK_JOB, setting, roleProblem };
