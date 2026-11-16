'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { normalize } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { send } = require('../lib/reply');

const TOP = 10;

/** /richest: the ten members with the most coins (wallet + bank). */
module.exports = {
  data: new SlashCommandBuilder().setName('richest').setDescription('Show the richest members'),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const cfg = getConfig(ctx.store, guildId);
    const users = ctx.store.guild(guildId).get('economy.users', {});
    const ranked = Object.entries(users)
      .map(([userId, raw]) => {
        const acc = normalize(raw);
        return { userId, total: acc.wallet + acc.bank };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP);
    if (!ranked.length) {
      return send(interaction, ctx.embeds.info(ctx.t(interaction, 'economy:richest.title'), ctx.t(interaction, 'economy:richest.empty')));
    }
    const lines = ranked.map((row, i) => `**${i + 1}.** <@${row.userId}> · ${formatMoney(row.total, cfg, interaction)}`);
    return send(interaction, ctx.embeds.info(ctx.t(interaction, 'economy:richest.title'), lines.join('\n')));
  }
};
