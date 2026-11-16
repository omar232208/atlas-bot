'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { parseIds } = require('../lib/purge');
const cases = require('../lib/cases');
const config = require('../lib/config');
const { confirm } = require('../../../core/confirm');
const { DELETE_CHOICES } = require('../commands/ban');
const { respond, fail, explainError } = require('../lib/format');

const MAX_IDS = 200;

module.exports = {
  name: 'massban',
  perm: PermissionFlagsBits.BanMembers,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('massban')
    .setDescription('Ban many users at once by ID (raids)')
    .addStringOption((o) => o.setName('ids').setDescription('User IDs or mentions, separated by spaces').setRequired(true).setMaxLength(6000))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addIntegerOption((o) => o.setName('delete_messages').setDescription('Delete their recent messages')
      .addChoices(...DELETE_CHOICES.map((v) => ({ name: String(v), value: v })))),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const { guild } = interaction;
    const gs = ctx.store.guild(guild.id);
    const reason = interaction.options.getString('reason');
    if (!reason && config.get(gs, 'requireReason')) return fail(ctx, interaction, 'moderation:errors.reasonRequired');
    if (!ctx.permissions.botCan(guild, PermissionFlagsBits.BanMembers)) return explainError(ctx, interaction, { code: 50013 }, 'BanMembers');
    const ids = parseIds(interaction.options.getString('ids', true));
    if (!ids.length) return fail(ctx, interaction, 'moderation:errors.badId');
    if (ids.length > MAX_IDS) return fail(ctx, interaction, 'moderation:errors.tooManyIds', { max: MAX_IDS });

    // Drop the IDs this moderator is not allowed to ban (self, bot, owner, higher roles).
    const skipped = [];
    const targets = [];
    for (const id of ids) {
      const member = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
      const forbidden = id === interaction.user.id || id === ctx.client.user.id || id === guild.ownerId
        || (member && (!ctx.permissions.canModerate(interaction.member, member) || !ctx.permissions.canModerate(guild.members.me, member)));
      (forbidden ? skipped : targets).push(id);
    }
    if (!targets.length) return fail(ctx, interaction, 'moderation:errors.noValidIds');
    const ok = await confirm(interaction, { description: t(interaction, 'moderation:massban.confirm', { count: targets.length, skipped: skipped.length }) });
    if (!ok) return null;

    const deleteMessageSeconds = interaction.options.getInteger('delete_messages') || 0;
    const audit = `${interaction.user.tag}: ${reason || 'massban'}`.slice(0, 512);
    let banned = [];
    let failed = [];
    try {
      // The bulk endpoint needs Manage Server too; without it, ban one by one.
      if (ctx.permissions.botCan(guild, PermissionFlagsBits.ManageGuild)) {
        const res = await guild.bans.bulkCreate(targets, { deleteMessageSeconds, reason: audit });
        banned = res.bannedUsers;
        failed = res.failedUsers;
      } else {
        for (const id of targets) {
          await guild.bans.create(id, { deleteMessageSeconds, reason: audit }).then(() => banned.push(id), () => failed.push(id));
        }
      }
    } catch (err) {
      return explainError(ctx, interaction, err, 'BanMembers');
    }
    for (const id of banned) {
      cases.createCase(gs, {
        type: 'ban', userId: id, userTag: ctx.client.users.cache.get(id)?.tag || id,
        moderatorId: interaction.user.id, moderatorTag: interaction.user.tag, reason, extra: { massban: true }
      });
    }
    const summary = embeds.base({
      title: t(guild, 'moderation:massban.logTitle'),
      description: banned.slice(0, 60).map((id) => `<@${id}> (${id})`).join('\n') || '-',
      fields: [
        { name: t(guild, 'moderation:case.moderator'), value: `<@${interaction.user.id}>`, inline: true },
        { name: t(guild, 'moderation:massban.banned'), value: String(banned.length), inline: true },
        { name: t(guild, 'moderation:massban.failed'), value: String(failed.length + skipped.length), inline: true },
        { name: t(guild, 'moderation:case.reason'), value: reason || t(guild, 'moderation:case.noReason') }
      ],
      timestamp: true
    });
    await ctx.modlog.send(guild, 'moderation', summary);
    return respond(interaction, embeds.success(t(interaction, 'moderation:massban.done', { count: banned.length }), t(interaction, 'moderation:massban.doneText', { failed: failed.length, skipped: skipped.length })));
  }
};
