'use strict';

const flow = require('../lib/blackjack-flow');

/**
 * Handles the Hit / Stand / Double buttons. customId: eco:bj:<gameId>:<action>.
 * The game is looked up under the clicking user, so a button on someone
 * else's table can never act on it; it gets an ephemeral refusal instead.
 */
const blackjackComponent = {
  prefix: 'eco:bj:',
  async execute(interaction, ctx) {
    const [, , gameId, action] = interaction.customId.split(':');
    const own = ctx.store.guild(interaction.guildId).get(flow.gameKey(interaction.user.id));
    if (!own || own.id !== gameId) {
      return interaction.reply({
        embeds: [ctx.embeds.error(ctx.t(interaction, 'economy:errors.title'), ctx.t(interaction, 'economy:errors.notYourGame'))],
        flags: 64
      });
    }
    const result = flow.act(ctx, interaction, gameId, action);
    if (result.error) {
      return interaction.update({
        embeds: [ctx.embeds.error(ctx.t(interaction, 'economy:errors.title'), ctx.t(interaction, result.error))],
        components: []
      });
    }
    return interaction.update(result.payload);
  }
};

module.exports = { blackjackComponent };
