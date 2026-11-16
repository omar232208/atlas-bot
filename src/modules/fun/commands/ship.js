'use strict';

const { MessageFlags, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const { shipScore, verdictIndex, blendNames } = require('../games/rules/fancy');

/** Ten-cell progress bar, filled proportionally to the score. */
const bar = (score) => {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('ship')
    .setDescription(en('fun:commands.fun.options.ship.description'))
    .addUserOption((o) => o.setName('first').setDescription(en('fun:commands.fun.options.ship.options.first')).setRequired(true))
    .addUserOption((o) => o.setName('second').setDescription(en('fun:commands.fun.options.ship.options.second')).setRequired(true)),

  /**
   * The score depends only on the two IDs, so the same pair always gets the
   * same result. Nothing is stored and nobody can "re-roll" it.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const first = interaction.options.getUser('first', true);
    const second = interaction.options.getUser('second', true);
    if (first.id === second.id) {
      return interaction.reply({ embeds: [embeds.error(t(interaction, 'fun:errors.shipSelf'))], flags: MessageFlags.Ephemeral });
    }
    const score = shipScore(first.id, second.id);
    const names = [first.displayName, second.displayName];
    await interaction.reply({
      embeds: [embeds.info(t(interaction, 'fun:ship.title'), [
        t(interaction, 'fun:ship.pair', { first: first.toString(), second: second.toString() }),
        '',
        t(interaction, 'fun:ship.name', { name: blendNames(names[0], names[1]) }),
        t(interaction, 'fun:ship.score', { score }),
        `\`${bar(score)}\``,
        `*${t(interaction, `fun:ship.verdicts.${verdictIndex(score)}`)}*`
      ].join('\n'))]
    });
  }
};
