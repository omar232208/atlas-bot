'use strict';

const { MessageFlags, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const { emojify } = require('../games/rules/fancy');

const MAX_LENGTH = 150;

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('emojify')
    .setDescription(en('fun:commands.fun.options.emojify.description'))
    .addStringOption((o) => o.setName('text').setDescription(en('fun:commands.fun.options.emojify.options.text')).setRequired(true).setMaxLength(MAX_LENGTH)),

  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const text = interaction.options.getString('text', true).trim();
    if (!text) {
      return interaction.reply({ embeds: [embeds.error(t(interaction, 'fun:errors.empty'))], flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({
      embeds: [embeds.info(t(interaction, 'fun:emojify.title'), emojify(text))]
    });
  }
};
