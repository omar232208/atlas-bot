'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { runSanction } = require('../lib/run');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500))
    .addBooleanOption((o) => o.setName('silent').setDescription('Do not send a DM to the user')),
  cooldown: 3,
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    return runSanction(ctx, interaction, {
      type: 'kick',
      flag: 'KickMembers',
      user: interaction.options.getUser('user', true),
      reason: interaction.options.getString('reason'),
      silent: interaction.options.getBoolean('silent') || false,
      needsMember: true
    });
  }
};
