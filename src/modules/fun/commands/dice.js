'use strict';

const crypto = require('node:crypto');
const { SlashCommandBuilder } = require('discord.js');
const en = require('../en');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription(en('fun:commands.dice.description'))
    .addIntegerOption((o) => o.setName('sides').setDescription(en('fun:commands.dice.options.sides')).setMinValue(2).setMaxValue(1000))
    .addIntegerOption((o) => o.setName('count').setDescription(en('fun:commands.dice.options.count')).setMinValue(1).setMaxValue(20)),

  /**
   * Rolls with crypto.randomInt rather than Math.random, which is the same
   * generator the bot uses for every other random pick.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const sides = interaction.options.getInteger('sides') ?? 6;
    const count = interaction.options.getInteger('count') ?? 1;
    const rolls = Array.from({ length: count }, () => crypto.randomInt(1, sides + 1));
    const total = rolls.reduce((sum, n) => sum + n, 0);
    await interaction.reply({
      embeds: [embeds.info(t(interaction, 'fun:dice.title'), [
        t(interaction, 'fun:dice.result', { count, sides }),
        t(interaction, 'fun:dice.rolls', { rolls: rolls.join(', ') }),
        `**${t(interaction, 'fun:dice.total', { total })}**`
      ].join('\n'))]
    });
  }
};
