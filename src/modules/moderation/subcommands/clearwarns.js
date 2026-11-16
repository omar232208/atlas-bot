'use strict';

const { PermissionFlagsBits } = require('discord.js');
const cases = require('../lib/cases');
const config = require('../lib/config');
const { confirm } = require('../../../core/confirm');
const { respond, fail, caseEmbed } = require('../lib/format');

module.exports = {
  name: 'clearwarns',
  perm: PermissionFlagsBits.ModerateMembers,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('clearwarns')
    .setDescription('Remove every active warning of a member')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t } = ctx;
    const { guild } = interaction;
    const gs = ctx.store.guild(guild.id);
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');
    if (!reason && config.get(gs, 'requireReason')) return fail(ctx, interaction, 'moderation:errors.reasonRequired');
    const active = cases.listCases(gs, { userId: user.id, type: 'warn' }).filter((c) => c.active !== false);
    if (!active.length) return fail(ctx, interaction, 'moderation:errors.noWarns');
    const ok = await confirm(interaction, { description: t(interaction, 'moderation:clearwarns.confirm', { count: active.length, user: user.tag || user.username }) });
    if (!ok) return null;
    const count = cases.clearWarns(gs, user.id);
    const entry = cases.createCase(gs, {
      type: 'clearwarns', userId: user.id, userTag: user.tag || user.username,
      moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, extra: { count }
    });
    await ctx.modlog.send(guild, 'moderation', caseEmbed(ctx, guild, entry));
    return respond(interaction, ctx.embeds.success(t(interaction, 'moderation:done.clearwarns', { user: entry.userTag }), t(interaction, 'moderation:done.clearwarnsText', { count, case: entry.id })));
  }
};
