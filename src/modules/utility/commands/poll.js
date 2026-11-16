'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const en = require('../en');
const duration = require('../../../core/duration');
const permissions = require('../../../core/permissions');
const poll = require('../poll');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription(en('utility:commands.poll.description'))
    .addStringOption((o) => o.setName('question').setDescription(en('utility:commands.poll.options.question')).setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName('options').setDescription(en('utility:commands.poll.options.options')).setRequired(true).setMaxLength(500))
    .addStringOption((o) => o.setName('duration').setDescription(en('utility:commands.poll.options.duration')).setMaxLength(20)),

  /**
   * Validates the options and duration, then hands the poll to poll.js, which
   * stores it, shows it and schedules its end.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const reject = (key, vars) => interaction.reply({ embeds: [embeds.error(t(interaction, key, vars))], flags: MessageFlags.Ephemeral });

    if (!permissions.botCan(interaction.guild, 'SendMessages', interaction.channel)) {
      return reject('utility:errors.missingBotPerm', { perm: t(interaction, 'utility:errors.permSendMessages') });
    }
    const question = interaction.options.getString('question', true).trim();
    const options = interaction.options.getString('options', true).split('|').map((s) => s.trim()).filter(Boolean);
    if (options.length < 2 || options.length > poll.MAX_OPTIONS) {
      return reject('utility:errors.pollOptions', { max: poll.MAX_OPTIONS });
    }
    if (options.some((option) => option.length > poll.MAX_OPTION_LENGTH)) {
      return reject('utility:errors.pollOptionLong', { max: poll.MAX_OPTION_LENGTH });
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      return reject('utility:errors.pollDuplicate');
    }

    const raw = interaction.options.getString('duration');
    const ms = raw === null ? poll.DEFAULT_POLL_MS : duration.parse(raw);
    if (ms === null) return reject('utility:errors.invalidDuration');
    if (ms > poll.MAX_POLL_MS) return reject('utility:errors.pollTooLong');

    await poll.createPoll(interaction, ctx, { question, options, ms });
  }
};
