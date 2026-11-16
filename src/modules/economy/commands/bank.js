'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { parseAmount } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/**
 * Deposit and withdraw move coins between wallet and bank. Only the wallet
 * can be robbed, so banking is the protection against /rob.
 * @param {'deposit'|'withdraw'} direction
 */
function bankCommand(direction) {
  const from = direction === 'deposit' ? 'wallet' : 'bank';
  const to = direction === 'deposit' ? 'bank' : 'wallet';
  return {
    data: new SlashCommandBuilder()
      .setName(direction)
      .setDescription(direction === 'deposit' ? 'Move coins from your wallet to your bank' : 'Move coins from your bank to your wallet')
      .addStringOption((o) => o.setName('amount').setDescription('Amount, or "all"').setRequired(true)),
    async execute(interaction, ctx) {
      const guildId = interaction.guildId;
      const cfg = getConfig(ctx.store, guildId);
      const result = updateAccount(ctx.store, guildId, interaction.user.id, (acc) => {
        const amount = parseAmount(interaction.options.getString('amount', true), acc[from]);
        if (!amount) return { error: 'economy:errors.invalidAmount' };
        if (amount > acc[from]) return { error: 'economy:errors.notEnough' };
        acc[from] -= amount;
        acc[to] += amount;
        return { amount };
      });
      if (result.error) return fail(ctx, interaction, result.error);
      return send(interaction, ctx.embeds.success(
        ctx.t(interaction, `economy:${direction}.title`),
        ctx.t(interaction, `economy:${direction}.done`, { amount: formatMoney(result.amount, cfg, interaction) })
      ));
    }
  };
}

module.exports = { deposit: bankCommand('deposit'), withdraw: bankCommand('withdraw') };
