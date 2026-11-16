'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runSanction, readDuration } = require('../lib/run');
const { fail } = require('../lib/format');

/** Message deletion choices, in seconds (Discord allows up to 7 days). */
const DELETE_CHOICES = [0, 3600, 21600, 43200, 86400, 259200, 604800];

module.exports = {
  DELETE_CHOICES,
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user, optionally for a limited time')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addStringOption((o) => o.setName('duration').setDescription('Temporary ban duration, e.g. 7d').setMaxLength(20))
    .addIntegerOption((o) => o.setName('delete_messages').setDescription('Delete their recent messages')
      .addChoices(...DELETE_CHOICES.map((v) => ({ name: String(v), value: v }))))
    .addBooleanOption((o) => o.setName('silent').setDescription('Do not send a DM to the user')),
  cooldown: 3,
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const user = interaction.options.getUser('user', true);
    const durationMs = readDuration(interaction);
    if (durationMs === null) return fail(ctx, interaction, 'moderation:errors.badDuration');
    const existing = await interaction.guild.bans.fetch({ user: user.id, force: true }).catch(() => null);
    if (existing) return fail(ctx, interaction, 'moderation:errors.alreadyBanned');
    return runSanction(ctx, interaction, {
      type: 'ban',
      flag: 'BanMembers',
      user,
      reason: interaction.options.getString('reason'),
      durationMs,
      deleteSeconds: interaction.options.getInteger('delete_messages') || 0,
      silent: interaction.options.getBoolean('silent') || false
    });
  }
};
