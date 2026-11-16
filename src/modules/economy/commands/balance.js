'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { getAccount } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const { send, fail } = require('../lib/reply');

/** /balance: wallet, bank and total of the caller or of another member. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Show the wallet and bank balance')
    .addUserOption((o) => o.setName('user').setDescription('Member to look up').setRequired(false)),
  async execute(interaction, ctx) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    if (target.bot) return fail(ctx, interaction, 'economy:errors.botTarget');
    const cfg = getConfig(ctx.store, interaction.guildId);
    const acc = getAccount(ctx.store, interaction.guildId, target.id);
    const fields = [
      { name: ctx.t(interaction, 'economy:balance.wallet'), value: formatMoney(acc.wallet, cfg, interaction), inline: true },
      { name: ctx.t(interaction, 'economy:balance.bank'), value: formatMoney(acc.bank, cfg, interaction), inline: true },
      { name: ctx.t(interaction, 'economy:balance.total'), value: formatMoney(acc.wallet + acc.bank, cfg, interaction), inline: true }
    ];
    const embed = ctx.embeds.info(ctx.t(interaction, 'economy:balance.title', { user: target.username }), undefined, { fields });
    return send(interaction, embed);
  }
};
