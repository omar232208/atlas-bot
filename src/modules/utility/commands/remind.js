'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const en = require('../en');
const duration = require('../../../core/duration');
const { readSetting } = require('../settings');

/** Scheduler job type, handled by init() in index.js. */
const JOB_REMIND = 'utility:remind';
const MAX_TEXT = 300;

module.exports = {
  JOB_REMIND,
  data: new SlashCommandBuilder()
    .setName('remind')
    .setDescription(en('utility:commands.remind.description'))
    .addStringOption((o) => o.setName('delay').setDescription(en('utility:commands.remind.options.delay')).setRequired(true).setMaxLength(20))
    .addStringOption((o) => o.setName('text').setDescription(en('utility:commands.remind.options.text')).setRequired(true).setMaxLength(MAX_TEXT)),

  /**
   * Schedules the reminder as a persistent job, so it still fires after a
   * restart. The reminder is posted in the channel where it was requested.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const reject = (key, vars) => interaction.reply({ embeds: [embeds.error(t(interaction, key, vars))], flags: MessageFlags.Ephemeral });
    const ms = duration.parse(interaction.options.getString('delay', true));
    if (ms === null) return reject('utility:errors.invalidDuration');
    const maxDays = readSetting(interaction.guildId, 'utility.remind.maxDays');
    if (ms > maxDays * 86400000) return reject('utility:errors.remindTooLong', { max: maxDays });

    const text = interaction.options.getString('text', true).trim();
    const runAt = Date.now() + ms;
    ctx.scheduler.schedule(JOB_REMIND, runAt, {
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      text
    });
    await interaction.reply({
      embeds: [embeds.success(t(interaction, 'utility:remind.title'), t(interaction, 'utility:remind.set', { when: Math.floor(runAt / 1000), text }))]
    });
  }
};
