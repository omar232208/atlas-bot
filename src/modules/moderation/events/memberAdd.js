'use strict';

const { Events } = require('discord.js');
const { reapplyTimeout, PENDING_TIMEOUTS } = require('../lib/actions');

/**
 * Timeouts longer than 28 days are re-applied by the scheduler; when the
 * member was away at that moment, the rest is applied as soon as they rejoin
 * so leaving and coming back does not shorten the sanction.
 */
module.exports = {
  event: Events.GuildMemberAdd,
  async execute(ctx, member) {
    const gs = ctx.store.guild(member.guild.id);
    const until = gs.get(`${PENDING_TIMEOUTS}.${member.id}`);
    if (!until) return;
    gs.delete(`${PENDING_TIMEOUTS}.${member.id}`);
    await reapplyTimeout(ctx, member, until);
  }
};
