'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { paginate, chunk } = require('../../../core/paginate');
const { levelFromXp } = require('../lib/xp');
const { send } = require('../lib/reply');

const PER_PAGE = 10;

/** /leaderboard: everyone with XP, ten per page. */
module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Show the most active members'),
  async execute(interaction, ctx) {
    const users = ctx.store.guild(interaction.guildId).get('levels.users', {});
    const ranked = Object.entries(users)
      .filter(([, rec]) => (rec?.xp || 0) > 0)
      .sort((a, b) => b[1].xp - a[1].xp);
    const title = ctx.t(interaction, 'levels:leaderboard.title');
    if (!ranked.length) return send(interaction, ctx.embeds.info(title, ctx.t(interaction, 'levels:leaderboard.empty')));

    const lines = ranked.map(([userId, rec], i) => ctx.t(interaction, 'levels:leaderboard.line', {
      rank: i + 1, user: `<@${userId}>`, level: levelFromXp(rec.xp), xp: rec.xp
    }));
    const pages = chunk(lines, PER_PAGE).map((description) => ctx.embeds.info(title, description));
    return paginate(interaction, pages);
  }
};
