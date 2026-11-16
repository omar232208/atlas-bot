'use strict';

const crypto = require('node:crypto');
const { SlashCommandBuilder } = require('discord.js');
const en = require('../en');

/** Number of answers in locales/<lang>/fun.json under "eightball.answers" (checked by the tests). */
const ANSWER_COUNT = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription(en('fun:commands.8ball.description'))
    .addStringOption((o) => o.setName('question').setDescription(en('fun:commands.8ball.options.question')).setRequired(true).setMaxLength(200)),

  /**
   * Answers with one random fortune. The question is shown in the footer, not
   * in the description, so the answer stays the visual focus.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const question = interaction.options.getString('question', true);
    const index = crypto.randomInt(ANSWER_COUNT);
    const answer = t(interaction, `fun:eightball.answers.${index}`);
    await interaction.reply({
      embeds: [embeds.info(t(interaction, 'fun:eightball.title'), `**${answer}**`, {
        footer: t(interaction, 'fun:eightball.question', { question })
      })]
    });
  }
};
