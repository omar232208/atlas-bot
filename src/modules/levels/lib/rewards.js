'use strict';

const { PermissionFlagsBits } = require('discord.js');
const permissions = require('../../../core/permissions');

/**
 * Gives the reward roles for every level in (from, to]. Rewards stack: a
 * member keeps the roles of earlier levels. A role the bot cannot give (missing
 * permission, or above the bot's role) is logged and skipped, never fatal.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} member
 * @param {number} from
 * @param {number} to
 */
async function grantRewards(ctx, guild, member, from, to) {
  const rewards = ctx.store.guild(guild.id).get('levels.rewards', {});
  const roleIds = Object.entries(rewards)
    .filter(([level]) => Number(level) > from && Number(level) <= to)
    .map(([, roleId]) => roleId);
  const me = guild.members.me;
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role || member.roles.cache.has(roleId)) continue;
    if (role.managed || !permissions.botCan(guild, PermissionFlagsBits.ManageRoles) || !me || role.position >= me.roles.highest.position) {
      ctx.logger.warn(`levels: cannot give reward role ${roleId} in ${guild.id}`);
      continue;
    }
    await member.roles.add(roleId, 'Level reward').catch((err) => ctx.logger.warn('levels: reward failed:', err.message));
  }
}

module.exports = { grantRewards };
