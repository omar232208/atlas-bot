'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const duration = require('../../../core/duration');
const { readConfig } = require('../logic');
const { getRaid, startRaid, endRaid, permNames } = require('../raid');

const NS = 'antiraid';
const MAX_MS = 7 * 86400000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raidmode')
    .setDescription('Turn raid mode on or off by hand')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('on').setDescription('Turn raid mode on')
      .addStringOption((o) => o.setName('duration').setDescription('How long (e.g. 30m, 2h)').setMaxLength(20)))
    .addSubcommand((s) => s.setName('off').setDescription('Turn raid mode off')),
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
    const flags = MessageFlags.Ephemeral;
    const guild = interaction.guild;
    if (interaction.options.getSubcommand() === 'off') {
      await interaction.deferReply({ flags });
      const done = await endRaid(ctx, guild, interaction.user.id);
      return interaction.editReply({ embeds: [done ? ctx.embeds.success(t('raid.endTitle'), t('raid.endedBy', { user: `<@${interaction.user.id}>` })) : ctx.embeds.info(t('raid.notActive'))] });
    }

    const cfg = readConfig(ctx.store.guild(guild.id));
    const text = interaction.options.getString('duration');
    let ms = cfg.raidDurationMin * 60000;
    if (text) {
      ms = duration.parse(text);
      if (!ms) return interaction.reply({ embeds: [ctx.embeds.error(t('errors.badDuration'), t('errors.badDurationHelp'))], flags });
      ms = Math.min(ms, MAX_MS);
    }
    if (getRaid(ctx.store, guild.id)) return interaction.reply({ embeds: [ctx.embeds.info(t('raid.alreadyActive'))], flags });
    // Raid mode is useless if the bot cannot remove anyone: say it before turning it on.
    const need = cfg.raidAction === 'ban' ? ['BanMembers'] : cfg.raidAction === 'kick' ? ['KickMembers'] : ['ModerateMembers'];
    const missing = ctx.permissions.botMissing(guild, need);
    if (missing.length) return interaction.reply({ embeds: [ctx.embeds.error(t('errors.missingPerms'), t('errors.missingPermsHelp', { perms: permNames(interaction, ctx.t, missing) }))], flags });
    await interaction.deferReply({ flags });
    await startRaid(ctx, guild, { by: interaction.user.id, auto: false, durationMs: ms });
    return interaction.editReply({ embeds: [ctx.embeds.warn(t('raid.startTitle'), t('raid.onReply', { duration: duration.format(ms, interaction), action: t(`actions.${cfg.raidAction}`) }))] });
  }
};
