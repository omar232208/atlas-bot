'use strict';

const { SlashCommandBuilder } = require('discord.js');
const duration = require('../../../core/duration');
const { updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { dailyStatus, dailyReward } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/** /daily: once every 24 h, with a streak bonus for consecutive days. */
module.exports = {
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const cfg = getConfig(ctx.store, guildId);
    const now = Date.now();
    const result = updateAccount(ctx.store, guildId, interaction.user.id, (acc) => {
      const status = dailyStatus(acc.daily, now);
      if (!status.ready) return { wait: status.wait };
      const amount = dailyReward(cfg.daily, status.streak);
      acc.daily = { last: now, streak: status.streak };
      acc.wallet += amount;
      return { amount, streak: status.streak };
    });
    if (result.wait) {
      return fail(ctx, interaction, 'economy:errors.cooldown', { time: duration.format(result.wait, interaction) });
    }
    const embed = ctx.embeds.success(
      ctx.t(interaction, 'economy:daily.title'),
      ctx.t(interaction, 'economy:daily.done', { amount: formatMoney(result.amount, cfg, interaction) }),
      { fields: [{ name: ctx.t(interaction, 'economy:daily.streak'), value: String(result.streak), inline: true }] }
    );
    return send(interaction, embed);
  }
};
