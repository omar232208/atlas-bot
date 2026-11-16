'use strict';

const crypto = require('node:crypto');
const { MessageFlags, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 25;

/**
 * Splits the user's list. A "|" wins over commas, because options such as
 * "pizza, sushi" are often written with commas inside them.
 * @param {string} raw
 * @returns {string[]} Trimmed, non-empty options.
 */
function splitOptions(raw) {
  const parts = raw.includes('|') ? raw.split('|') : raw.split(',');
  return parts.map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('choose')
    .setDescription(en('fun:commands.fun.options.choose.description'))
    .addStringOption((o) => o.setName('options').setDescription(en('fun:commands.fun.options.choose.options.options')).setRequired(true).setMaxLength(1000)),

  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const options = splitOptions(interaction.options.getString('options', true));
    if (options.length < MIN_OPTIONS) {
      return interaction.reply({ embeds: [embeds.error(t(interaction, 'fun:errors.chooseFew'))], flags: MessageFlags.Ephemeral });
    }
    if (options.length > MAX_OPTIONS) {
      return interaction.reply({ embeds: [embeds.error(t(interaction, 'fun:errors.chooseMany'))], flags: MessageFlags.Ephemeral });
    }
    const choice = options[crypto.randomInt(options.length)];
    await interaction.reply({
      embeds: [embeds.info(t(interaction, 'fun:choose.title'), t(interaction, 'fun:choose.result', { choice }), {
        footer: t(interaction, 'fun:choose.among', { list: options.join(' · ') })
      })]
    });
  }
};
