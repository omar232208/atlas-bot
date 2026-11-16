'use strict';

const { SlashCommandBuilder } = require('discord.js');
const duration = require('../../../core/duration');
const { getAccount, updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { COOLDOWNS, ROB_MIN_WALLET, cooldownLeft, robOutcome } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/**
 * /rob: try to take part of another member's wallet. Costs a fine when it
 * fails. Robber and victim are read and written in one synchronous block.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('Try to rob another member (risky)')
    .addUserOption((o) => o.setName('user').setDescription('Member to rob').setRequired(true)),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const robber = interaction.user;
    const victim = interaction.options.getUser('user', true);
    if (victim.bot) return fail(ctx, interaction, 'economy:errors.botTarget');
    if (victim.id === robber.id) return fail(ctx, interaction, 'economy:rob.self');
    const cfg = getConfig(ctx.store, guildId);
    const now = Date.now();

    const me = getAccount(ctx.store, guildId, robber.id);
    const left = cooldownLeft(me.rob, COOLDOWNS.rob, now);
    if (left > 0) return fail(ctx, interaction, 'economy:errors.cooldown', { time: duration.format(left, interaction) });
    if (me.wallet < ROB_MIN_WALLET) return fail(ctx, interaction, 'economy:rob.tooPoor', { min: formatMoney(ROB_MIN_WALLET, cfg, interaction) });
    const targetWallet = getAccount(ctx.store, guildId, victim.id).wallet;
    if (targetWallet < 1) return fail(ctx, interaction, 'economy:rob.victimBroke', { user: victim.toString() });

    const outcome = robOutcome({ robberWallet: me.wallet, targetWallet, failPercent: cfg.robFailPercent, rng: Math.random });
    updateAccount(ctx.store, guildId, robber.id, (acc) => {
      acc.rob = now;
      acc.wallet += outcome.success ? outcome.amount : -outcome.amount;
    });
    if (outcome.success) updateAccount(ctx.store, guildId, victim.id, (acc) => { acc.wallet -= outcome.amount; });

    const money = formatMoney(outcome.amount, cfg, interaction);
    const key = outcome.success ? 'economy:rob.success' : 'economy:rob.failed';
    const text = ctx.t(interaction, key, { amount: money, user: victim.toString() });
    const embed = outcome.success
      ? ctx.embeds.success(ctx.t(interaction, 'economy:rob.title'), text)
      : ctx.embeds.error(ctx.t(interaction, 'economy:rob.title'), text);
    return send(interaction, embed);
  }
};
