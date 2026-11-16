'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const cases = require('../lib/cases');
const { confirm } = require('../../../core/confirm');
const { JOB_UNBAN } = require('../lib/actions');
const { respond, fail, caseEmbed } = require('../lib/format');
const duration = require('../../../core/duration');

const caseOption = (o) => o.setName('number').setDescription('Case number').setRequired(true).setMinValue(1);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('View, edit or delete a moderation case')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) => s.setName('view').setDescription('Show a case').addIntegerOption(caseOption))
    .addSubcommand((s) => s.setName('edit').setDescription('Change the reason (or the length of a temp ban)')
      .addIntegerOption(caseOption)
      .addStringOption((o) => o.setName('reason').setDescription('New reason').setMaxLength(500))
      .addStringOption((o) => o.setName('duration').setDescription('New temp ban length, counted from the ban').setMaxLength(20)))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a case').addIntegerOption(caseOption)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const { guild } = interaction;
    const gs = ctx.store.guild(guild.id);
    const sub = interaction.options.getSubcommand();
    const id = interaction.options.getInteger('number', true);
    const entry = cases.getCase(gs, id);
    if (!entry) return fail(ctx, interaction, 'moderation:errors.noCase', { id });

    if (sub === 'view') return respond(interaction, caseEmbed(ctx, interaction, entry));

    if (sub === 'edit') {
      const reason = interaction.options.getString('reason');
      const rawDuration = interaction.options.getString('duration');
      if (!reason && !rawDuration) return fail(ctx, interaction, 'moderation:errors.nothingToEdit');
      const patch = { editedAt: Date.now(), editedBy: interaction.user.id };
      if (reason) patch.reason = reason;
      if (rawDuration) {
        if (entry.type !== 'tempban') return fail(ctx, interaction, 'moderation:errors.durationOnlyTempban');
        const ms = duration.parse(rawDuration);
        if (!ms) return fail(ctx, interaction, 'moderation:errors.badDuration');
        const job = ctx.scheduler.list(JOB_UNBAN, (p) => p?.guildId === guild.id && p?.caseId === entry.id)[0];
        if (!job) return fail(ctx, interaction, 'moderation:errors.tempbanOver');
        // Reschedule from the original ban time; an expiry already past fires right away.
        ctx.scheduler.cancel(job.id);
        patch.duration = ms;
        patch.expiresAt = entry.createdAt + ms;
        ctx.scheduler.schedule(JOB_UNBAN, Math.max(Date.now(), patch.expiresAt), job.payload);
      }
      const next = cases.updateCase(gs, id, patch);
      await ctx.modlog.send(guild, 'moderation', caseEmbed(ctx, guild, next));
      return respond(interaction, caseEmbed(ctx, interaction, next).setTitle(t(interaction, 'moderation:case.editedTitle', { id })));
    }

    const ok = await confirm(interaction, { description: t(interaction, 'moderation:case.deleteConfirm', { id, type: t(interaction, `moderation:types.${entry.type}`) }) });
    if (!ok) return null;
    cases.deleteCase(gs, id);
    // A deleted temp ban no longer expires: the user stays banned until /unban.
    let note = '';
    if (entry.type === 'tempban') {
      const jobs = ctx.scheduler.list(JOB_UNBAN, (p) => p?.guildId === guild.id && p?.caseId === entry.id);
      for (const job of jobs) ctx.scheduler.cancel(job.id);
      if (jobs.length) note = `\n${t(interaction, 'moderation:case.deletedTempban')}`;
    }
    return respond(interaction, embeds.success(t(interaction, 'moderation:case.deleted', { id }), `${t(interaction, 'moderation:case.deletedText')}${note}`));
  }
};
