'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { getAccount } = require('../lib/accounts');
const { send } = require('../lib/reply');

/** /inventory: items bought so far, with quantities. */
module.exports = {
  data: new SlashCommandBuilder().setName('inventory').setDescription('Show the items you bought'),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const owned = Object.entries(getAccount(ctx.store, guildId, interaction.user.id).inventory).filter(([, qty]) => qty > 0);
    if (!owned.length) {
      return send(interaction, ctx.embeds.info(ctx.t(interaction, 'economy:inventory.title'), ctx.t(interaction, 'economy:inventory.empty')));
    }
    const fields = owned.map(([id, qty]) => {
      const item = ctx.store.guild(guildId).get(`economy.shop.${id}`);
      return {
        name: item ? item.name : id,
        value: item ? `x${qty}` : ctx.t(interaction, 'economy:inventory.removed', { qty }),
        inline: true
      };
    });
    return send(interaction, ctx.embeds.info(ctx.t(interaction, 'economy:inventory.title'), undefined, { fields: fields.slice(0, 25) }));
  }
};
