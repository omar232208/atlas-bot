'use strict';

const { Events } = require('discord.js');
const stats = require('../lib/stats');

module.exports = {
  event: Events.GuildMemberAdd,
  /**
   * @param {object} ctx
   * @param {import('discord.js').GuildMember} member
   */
  execute(ctx, member) {
    if (member.user?.bot) stats.invalidateBots(member.guild.id);
    if (stats.hasStats(ctx, member.guild.id)) stats.queue(ctx, member.guild);
  }
};
