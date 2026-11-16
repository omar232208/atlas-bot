'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { sanction } = require('../lib/actions');
const { respond, fail, explainError } = require('../lib/format');
const config = require('../lib/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user').setDescription('Banned user (ID or name)').setRequired(true).setAutocomplete(true).setMaxLength(40))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  /** Suggests banned users matching the typed text. */
  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    const bans = await interaction.guild.bans.fetch({ limit: 1000 }).catch(() => null);
    const list = bans ? [...bans.values()] : [];
    const out = list
      .filter((b) => !query || b.user.id.includes(query) || b.user.username.toLowerCase().includes(query) || (b.user.globalName || '').toLowerCase().includes(query))
      .slice(0, 25)
      .map((b) => ({ name: `${b.user.username} (${b.user.id})`.slice(0, 100), value: b.user.id }));
    await interaction.respond(out).catch(() => {});
  },
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { guild } = interaction;
    const raw = interaction.options.getString('user', true).trim();
    const id = (raw.match(/\d{17,20}/) || [])[0];
    if (!id) return fail(ctx, interaction, 'moderation:errors.badId');
    const reason = interaction.options.getString('reason');
    if (!reason && config.get(ctx.store.guild(guild.id), 'requireReason')) return fail(ctx, interaction, 'moderation:errors.reasonRequired');
    if (!ctx.permissions.botCan(guild, PermissionFlagsBits.BanMembers)) return explainError(ctx, interaction, { code: 50013 }, 'BanMembers');
    const ban = await guild.bans.fetch({ user: id, force: true }).catch(() => null);
    if (!ban) return fail(ctx, interaction, 'moderation:errors.notBanned');
    await interaction.deferReply();
    try {
      const { case: c } = await sanction(ctx, { guild, user: ban.user, moderator: interaction.user, type: 'unban', reason });
      return respond(interaction, ctx.embeds.success(ctx.t(interaction, 'moderation:done.unban', { user: c.userTag }), ctx.t(interaction, 'moderation:done.case', { id: c.id })));
    } catch (err) {
      return explainError(ctx, interaction, err, 'BanMembers');
    }
  }
};
