'use strict';

const { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const en = require('../en');
const permissions = require('../../../core/permissions');

const MAX_LENGTH = 1500;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription(en('utility:commands.say.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) => o.setName('message').setDescription(en('utility:commands.say.options.message')).setRequired(true).setMaxLength(MAX_LENGTH))
    .addChannelOption((o) => o.setName('channel').setDescription(en('utility:commands.say.options.channel')).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

  /**
   * Posts the text as the bot. Mentions are disabled on purpose: the bot must
   * not become a way to ping everyone from an account that is not allowed to.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const reject = (key, vars) => interaction.reply({ embeds: [embeds.error(t(interaction, key, vars))], flags: MessageFlags.Ephemeral });

    if (!permissions.botCan(interaction.guild, 'SendMessages', channel)) {
      return reject('utility:errors.missingBotPerm', { perm: t(interaction, 'utility:errors.permSendMessages') });
    }
    const content = interaction.options.getString('message', true);
    await channel.send({ content, allowedMentions: { parse: [] } });
    await interaction.reply({
      embeds: [embeds.success(t(interaction, 'utility:say.title'), t(interaction, 'utility:say.sent', { channel: channel.toString() }))],
      flags: MessageFlags.Ephemeral
    });
  }
};
