'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { coinflip } = require('../lib/games');
const { parseAmount } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/** /coinflip: 50/50 bet against the house. A win doubles the stake. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('Bet on heads or tails (50/50)')
    .addStringOption((o) => o.setName('amount').setDescription('Bet, or "all"').setRequired(true))
    .addStringOption((o) => o.setName('side').setDescription('Your pick').setRequired(true)
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const cfg = getConfig(ctx.store, guildId);
    const side = interaction.options.getString('side', true);
    const raw = interaction.options.getString('amount', true);
    const result = updateAccount(ctx.store, guildId, interaction.user.id, (acc) => {
      const bet = parseAmount(raw, acc.wallet);
      if (!bet) return { error: 'economy:errors.invalidAmount' };
      if (bet > acc.wallet) return { error: 'economy:errors.notEnough' };
      const flip = coinflip(Math.random, side);
      acc.wallet += flip.won ? bet : -bet;
      return { bet, flip };
    });
    if (result.error) return fail(ctx, interaction, result.error);
    const { bet, flip } = result;
    const text = ctx.t(interaction, flip.won ? 'economy:coinflip.won' : 'economy:coinflip.lost', {
      result: ctx.t(interaction, `economy:coinflip.sides.${flip.result}`),
      amount: formatMoney(bet, cfg, interaction)
    });
    const title = ctx.t(interaction, 'economy:coinflip.title');
    return send(interaction, flip.won ? ctx.embeds.success(title, text) : ctx.embeds.error(title, text));
  }
};
