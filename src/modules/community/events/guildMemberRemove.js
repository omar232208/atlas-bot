'use strict';

const { Events } = require('discord.js');
const stats = require('../lib/stats');
const { afkPath } = require('../lib/afk');

module.exports = {
  event: Events.GuildMemberRemove,
  /**
   * Updates counters and drops the AFK status of a member who left.
   * Birthdays are kept on purpose: members who come back find theirs again.
   * @param {object} ctx
   * @param {import('discord.js').GuildMember} member
   */
  execute(ctx, member) {
    ctx.store.guild(member.guild.id).delete(afkPath(member.id));
    if (member.user?.bot) stats.invalidateBots(member.guild.id);
    if (stats.hasStats(ctx, member.guild.id)) stats.queue(ctx, member.guild);
  }
};
