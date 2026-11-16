'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { getAccount, updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { parseAmount } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/** /pay: move coins from your wallet to another member's wallet. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Give coins from your wallet to another member')
    .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
    .addStringOption((o) => o.setName('amount').setDescription('Amount, or "all"').setRequired(true)),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const sender = interaction.user;
    const target = interaction.options.getUser('user', true);
    if (target.bot) return fail(ctx, interaction, 'economy:errors.botTarget');
    if (target.id === sender.id) return fail(ctx, interaction, 'economy:pay.self');
    const cfg = getConfig(ctx.store, guildId);
    const wallet = getAccount(ctx.store, guildId, sender.id).wallet;
    const amount = parseAmount(interaction.options.getString('amount', true), wallet);
    if (!amount) return fail(ctx, interaction, 'economy:errors.invalidAmount');
    if (amount > wallet) return fail(ctx, interaction, 'economy:errors.notEnough');

    // Both updates run in the same synchronous block, so the transfer is all or nothing.
    updateAccount(ctx.store, guildId, sender.id, (acc) => { acc.wallet -= amount; });
    updateAccount(ctx.store, guildId, target.id, (acc) => { acc.wallet += amount; });
    return send(interaction, ctx.embeds.success(
      ctx.t(interaction, 'economy:pay.title'),
      ctx.t(interaction, 'economy:pay.done', { amount: formatMoney(amount, cfg, interaction), user: target.toString() })
    ));
  }
};
