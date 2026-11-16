'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { getLockdown, startLockdown, endLockdown } = require('../lockdown');
const { report, permNames } = require('../raid');

const NS = 'antiraid';
const TEXTUAL = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Lock or unlock every public channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((s) => s.setName('start').setDescription('Lock every public channel')
      .addStringOption((o) => o.setName('reason').setDescription('Reason shown in logs').setMaxLength(300))
      .addBooleanOption((o) => o.setName('announce').setDescription('Post a notice in each locked text channel')))
    .addSubcommand((s) => s.setName('end').setDescription('Restore channel permissions as they were')),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
    const flags = MessageFlags.Ephemeral;
    const guild = interaction.guild;
    const missing = ctx.permissions.botMissing(guild, ['ManageChannels', 'ManageRoles']);
    if (missing.length) return interaction.reply({ embeds: [ctx.embeds.error(t('errors.missingPerms'), t('errors.missingPermsHelp', { perms: permNames(interaction, ctx.t, missing) }))], flags });
    const sub = interaction.options.getSubcommand();

    if (sub === 'end') {
      if (!getLockdown(ctx.store, guild.id)) return interaction.reply({ embeds: [ctx.embeds.info(t('lockdown.notActive'))], flags });
      await interaction.deferReply({ flags });
      const res = await endLockdown(guild, ctx.store, t('lockdown.auditEnd', { user: interaction.user.tag }));
      const embed = ctx.embeds[res.failed ? 'warn' : 'success'](t('lockdown.endTitle'), t('lockdown.endSummary', res));
      await report(ctx, guild, ctx.embeds.success(t('lockdown.endTitle'), t('lockdown.endLog', { user: `<@${interaction.user.id}>`, ...res }), { timestamp: true }));
      return interaction.editReply({ embeds: [embed] });
    }

    if (getLockdown(ctx.store, guild.id)) return interaction.reply({ embeds: [ctx.embeds.info(t('lockdown.alreadyActive'))], flags });
    await interaction.deferReply({ flags });
    const reason = interaction.options.getString('reason') || '';
    const announce = interaction.options.getBoolean('announce') ?? false;
    const notice = ctx.embeds.warn(t('lockdown.noticeTitle'), reason ? t('lockdown.noticeReason', { reason }) : t('lockdown.notice'));
    const res = await startLockdown(guild, ctx.store, {
      by: interaction.user.id,
      reason: t('lockdown.auditStart', { user: interaction.user.tag }),
      onLocked: announce ? (c) => (TEXTUAL.has(c.type) ? c.send({ embeds: [notice] }) : Promise.resolve()) : undefined
    });
    await report(ctx, guild, ctx.embeds.warn(t('lockdown.startTitle'), t('lockdown.startLog', { user: `<@${interaction.user.id}>`, reason: reason || '-', locked: res.locked, failed: res.failed }), { timestamp: true }));
    return interaction.editReply({ embeds: [ctx.embeds[res.failed ? 'warn' : 'success'](t('lockdown.startTitle'), t('lockdown.summary', res) + '\n' + t('lockdown.endHint'))] });
  }
};
