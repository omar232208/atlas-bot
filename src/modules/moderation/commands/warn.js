'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runSanction } = require('../lib/run');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member (warn thresholds can sanction automatically)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addBooleanOption((o) => o.setName('silent').setDescription('Do not send a DM to the user')),
  cooldown: 2,
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    return runSanction(ctx, interaction, {
      type: 'warn',
      // A warning itself needs no Discord permission; thresholds check their own.
      flag: null,
      user: interaction.options.getUser('user', true),
      reason: interaction.options.getString('reason'),
      silent: interaction.options.getBoolean('silent') || false,
      needsMember: true
    });
  }
};
