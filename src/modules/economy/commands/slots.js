'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { updateAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { SLOT_SYMBOLS, spinSlots, slotsResult } = require('../lib/games');
const { parseAmount } = require('../lib/rules');
const { send, fail } = require('../lib/reply');

/** /slots: three reels; a triple pays a big multiplier, a pair returns the stake. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('Spin the slot machine')
    .addStringOption((o) => o.setName('amount').setDescription('Bet, or "all"').setRequired(true)),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const cfg = getConfig(ctx.store, guildId);
    const raw = interaction.options.getString('amount', true);
    const reels = spinSlots(Math.random);
    const result = updateAccount(ctx.store, guildId, interaction.user.id, (acc) => {
      const bet = parseAmount(raw, acc.wallet);
      if (!bet) return { error: 'economy:errors.invalidAmount' };
      if (bet > acc.wallet) return { error: 'economy:errors.notEnough' };
      const { multiplier, kind } = slotsResult(reels);
      const net = bet * multiplier - bet;
      acc.wallet += net;
      return { bet, net, kind };
    });
    if (result.error) return fail(ctx, interaction, result.error);
    const line = reels.map((i) => SLOT_SYMBOLS[i].symbol).join('  |  ');
    const key = result.net > 0 ? 'economy:slots.won' : result.net === 0 ? 'economy:slots.even' : 'economy:slots.lost';
    const text = ctx.t(interaction, key, { amount: formatMoney(Math.abs(result.net), cfg, interaction) });
    const fields = [{ name: ctx.t(interaction, 'economy:slots.reels'), value: `**${line}**` }];
    const title = ctx.t(interaction, 'economy:slots.title');
    if (result.net > 0) return send(interaction, ctx.embeds.success(title, text, { fields }));
    if (result.net === 0) return send(interaction, ctx.embeds.info(title, text, { fields }));
    return send(interaction, ctx.embeds.error(title, text, { fields }));
  }
};
