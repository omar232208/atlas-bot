'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { runSanction } = require('../lib/run');

module.exports = {
  name: 'untimeout',
  perm: PermissionFlagsBits.ModerateMembers,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('untimeout')
    .setDescription('Remove the timeout of a member')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    return runSanction(ctx, interaction, {
      type: 'untimeout',
      flag: 'ModerateMembers',
      user: interaction.options.getUser('user', true),
      reason: interaction.options.getString('reason'),
      needsMember: true
    });
  }
};
