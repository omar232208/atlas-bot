'use strict';

const { SlashCommandBuilder } = require('discord.js');
const duration = require('../../../core/duration');
const { updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { COOLDOWNS, cooldownLeft } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/** /weekly: a bigger reward once every 7 days. */
module.exports = {
  data: new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly reward'),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const cfg = getConfig(ctx.store, guildId);
    const now = Date.now();
    const wait = updateAccount(ctx.store, guildId, interaction.user.id, (acc) => {
      const left = cooldownLeft(acc.weekly, COOLDOWNS.weekly, now);
      if (left > 0) return left;
      acc.weekly = now;
      acc.wallet += cfg.weekly;
      return 0;
    });
    if (wait > 0) return fail(ctx, interaction, 'economy:errors.cooldown', { time: duration.format(wait, interaction) });
    return send(interaction, ctx.embeds.success(
      ctx.t(interaction, 'economy:weekly.title'),
      ctx.t(interaction, 'economy:weekly.done', { amount: formatMoney(cfg.weekly, cfg, interaction) })
    ));
  }
};
