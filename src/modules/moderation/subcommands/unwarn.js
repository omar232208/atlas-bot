'use strict';

const { PermissionFlagsBits } = require('discord.js');
const cases = require('../lib/cases');
const config = require('../lib/config');
const { respond, fail, caseEmbed } = require('../lib/format');

module.exports = {
  name: 'unwarn',
  perm: PermissionFlagsBits.ModerateMembers,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('unwarn')
    .setDescription('Remove one warning by its case number')
    .addIntegerOption((o) => o.setName('case').setDescription('Case number of the warning').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t } = ctx;
    const { guild } = interaction;
    const gs = ctx.store.guild(guild.id);
    const id = interaction.options.getInteger('case', true);
    const reason = interaction.options.getString('reason');
    if (!reason && config.get(gs, 'requireReason')) return fail(ctx, interaction, 'moderation:errors.reasonRequired');
    const warn = cases.getCase(gs, id);
    if (!warn || warn.type !== 'warn') return fail(ctx, interaction, 'moderation:errors.notAWarn', { id });
    if (warn.active === false) return fail(ctx, interaction, 'moderation:errors.warnInactive', { id });
    cases.updateCase(gs, id, { active: false });
    const entry = cases.createCase(gs, {
      type: 'unwarn', userId: warn.userId, userTag: warn.userTag,
      moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, extra: { ref: id }
    });
    await ctx.modlog.send(guild, 'moderation', caseEmbed(ctx, guild, entry));
    return respond(interaction, ctx.embeds.success(t(interaction, 'moderation:done.unwarn', { user: warn.userTag }), t(interaction, 'moderation:done.unwarnText', { id, case: entry.id })));
  }
};
