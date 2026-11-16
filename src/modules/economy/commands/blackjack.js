'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { getAccount } = require('../lib/accounts');
const { parseAmount } = require('../lib/rules');
const flow = require('../lib/blackjack-flow');
const { fail } = require('../lib/reply');

/** /blackjack: opens a table with Hit / Stand / Double buttons (see components/blackjack.js). */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Play blackjack against the dealer')
    .addStringOption((o) => o.setName('amount').setDescription('Bet, or "all"').setRequired(true)),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const wallet = getAccount(ctx.store, guildId, interaction.user.id).wallet;
    const bet = parseAmount(interaction.options.getString('amount', true), wallet);
    if (!bet) return fail(ctx, interaction, 'economy:errors.invalidAmount');
    if (bet > wallet) return fail(ctx, interaction, 'economy:errors.notEnough');

    const started = flow.startGame(ctx, interaction, bet);
    if (started.error) return fail(ctx, interaction, started.error);
    const message = await interaction.reply({ ...started.reply, withResponse: true }).then((r) => r.resource.message);
    if (started.game) flow.attach(ctx, guildId, started.game, message.id);
    return undefined;
  }
};
