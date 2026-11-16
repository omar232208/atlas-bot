'use strict';

const { Events } = require('discord.js');
const stats = require('../lib/stats');

module.exports = {
  event: Events.GuildUpdate,
  /**
   * Boost count and tier changes arrive as guild updates.
   * @param {object} ctx
   * @param {import('discord.js').Guild} oldGuild
   * @param {import('discord.js').Guild} newGuild
   */
  execute(ctx, oldGuild, newGuild) {
    if (oldGuild.premiumSubscriptionCount === newGuild.premiumSubscriptionCount && oldGuild.premiumTier === newGuild.premiumTier) return;
    if (stats.hasStats(ctx, newGuild.id)) stats.queue(ctx, newGuild);
  }
};
