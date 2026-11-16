'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { startPanic, endPanic } = require('../panic');

const NS = 'antinuke';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panic')
    .setDescription('Panic mode: block everything from the first suspicious action')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('on').setDescription('Turn panic mode on')
      .addIntegerOption((o) => o.setName('minutes').setDescription('Panic mode length in minutes').setMinValue(5).setMaxValue(1440)))
    .addSubcommand((s) => s.setName('off').setDescription('Stop panic mode')),
  /**
   * Owner only, like the rest of the antinuke settings: panic mode changes the
   * permissions of every role.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
    const flags = MessageFlags.Ephemeral;
    const guild = interaction.guild;
    if (!ctx.permissions.isOwner(guild, interaction.user.id)) {
      return interaction.reply({ embeds: [ctx.embeds.error(t('errors.ownerOnly'), t('errors.ownerOnlyHelp'))], flags });
    }
    await interaction.deferReply({ flags });
    if (interaction.options.getSubcommand() === 'off') {
      const res = await endPanic(ctx, guild, interaction.user.id);
      return interaction.editReply({ embeds: [res.ended ? ctx.embeds.success(t('panic.endTitle'), t('panic.restoredValue', res)) : ctx.embeds.info(t('panic.notActive'))] });
    }
    const res = await startPanic(ctx, guild, { by: interaction.user.id, auto: false, minutes: interaction.options.getInteger('minutes') || undefined });
    if (!res.started) return interaction.editReply({ embeds: [ctx.embeds.info(t('panic.alreadyActive'))] });
    return interaction.editReply({ embeds: [ctx.embeds.warn(t('panic.startTitle'), `${t('panic.onReply')}\n${t('panic.rolesValue', res)}`)] });
  }
};
