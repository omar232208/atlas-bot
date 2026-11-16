'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runSanction, readDuration } = require('../lib/run');
const { fail } = require('../lib/format');

// Longer timeouts are kept by re-applying them every 28 days (see actions.js).
const MAX_MS = 365 * 86400000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Time out a member (they cannot talk or join voice)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to time out').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('Duration, e.g. 10m, 2h, 7d').setRequired(true).setMaxLength(20))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addBooleanOption((o) => o.setName('silent').setDescription('Do not send a DM to the user')),
  cooldown: 3,
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const durationMs = readDuration(interaction);
    if (!durationMs || durationMs < 5000 || durationMs > MAX_MS) return fail(ctx, interaction, 'moderation:errors.badTimeout');
    return runSanction(ctx, interaction, {
      type: 'timeout',
      flag: 'ModerateMembers',
      user: interaction.options.getUser('user', true),
      reason: interaction.options.getString('reason'),
      durationMs,
      silent: interaction.options.getBoolean('silent') || false,
      needsMember: true
    });
  }
};
