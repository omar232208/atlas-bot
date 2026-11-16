'use strict';

const { MessageFlags } = require('discord.js');

/**
 * Sends one embed as the reply to an interaction (or edits the reply when it
 * was already deferred). Errors are ephemeral so a refused bet does not
 * clutter the channel.
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {{ephemeral?: boolean}} [opts]
 */
function send(interaction, embed, opts = {}) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({ embeds: [embed] });
  return interaction.reply({ embeds: [embed], flags: opts.ephemeral ? MessageFlags.Ephemeral : undefined });
}

/**
 * Localized error embed, ephemeral.
 * @param {object} ctx
 * @param {import('discord.js').Interaction} interaction
 * @param {string} key Translation key of the message.
 * @param {object} [vars]
 */
function fail(ctx, interaction, key, vars) {
  const embed = ctx.embeds.error(ctx.t(interaction, 'economy:errors.title'), ctx.t(interaction, key, vars));
  return send(interaction, embed, { ephemeral: true });
}

module.exports = { send, fail };
