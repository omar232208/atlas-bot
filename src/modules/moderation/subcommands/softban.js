'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { runSanction } = require('../lib/run');
const { DELETE_CHOICES } = require('../commands/ban');

module.exports = {
  name: 'softban',
  perm: PermissionFlagsBits.BanMembers,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('softban')
    .setDescription('Ban then unban a member to delete their messages')
    .addUserOption((o) => o.setName('user').setDescription('Member to softban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addIntegerOption((o) => o.setName('delete_messages').setDescription('Delete their recent messages')
      .addChoices(...DELETE_CHOICES.filter(Boolean).map((v) => ({ name: String(v), value: v }))))
    .addBooleanOption((o) => o.setName('silent').setDescription('Do not send a DM to the user')),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    return runSanction(ctx, interaction, {
      type: 'softban',
      flag: 'BanMembers',
      user: interaction.options.getUser('user', true),
      reason: interaction.options.getString('reason'),
      deleteSeconds: interaction.options.getInteger('delete_messages') || 86400,
      silent: interaction.options.getBoolean('silent') || false,
      needsMember: true
    });
  }
};
