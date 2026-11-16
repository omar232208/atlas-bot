'use strict';

const { SlashCommandBuilder } = require('discord.js');
const duration = require('../../../core/duration');
const { updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { COOLDOWNS, cooldownLeft, workReward, randInt } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/** Number of job flavour texts; keys economy:work.jobs.0 .. N-1 in the locales. */
const JOB_COUNT = 5;

/** /work: earn a random amount once an hour, with a flavour text. */
module.exports = {
  data: new SlashCommandBuilder().setName('work').setDescription('Work for some money (once an hour)'),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const cfg = getConfig(ctx.store, guildId);
    const now = Date.now();
    const result = updateAccount(ctx.store, guildId, interaction.user.id, (acc) => {
      const left = cooldownLeft(acc.work, COOLDOWNS.work, now);
      if (left > 0) return { wait: left };
      const amount = workReward(cfg.workMin, cfg.workMax, Math.random);
      acc.work = now;
      acc.wallet += amount;
      return { amount, job: randInt(Math.random, 0, JOB_COUNT - 1) };
    });
    if (result.wait) return fail(ctx, interaction, 'economy:errors.cooldown', { time: duration.format(result.wait, interaction) });
    const amount = formatMoney(result.amount, cfg, interaction);
    return send(interaction, ctx.embeds.success(
      ctx.t(interaction, 'economy:work.title'),
      ctx.t(interaction, `economy:work.jobs.${result.job}`, { amount })
    ));
  }
};
