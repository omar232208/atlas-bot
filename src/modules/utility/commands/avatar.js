'use strict';

const { SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('avatar')
    .setDescription(en('utility:commands.info.options.avatar.description'))
    .addUserOption((o) => o.setName('user').setDescription(en('utility:commands.info.options.avatar.options.user'))),

  /**
   * Shows the avatar at full size. The server avatar is used when the member has
   * one, because it is what other members actually see in this server.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild.members.cache.get(user.id);
    const url = (member ?? user).displayAvatarURL({ size: 1024 });
    const embed = embeds.info(t(interaction, 'utility:avatar.title', { name: user.displayName }), `[${t(interaction, 'utility:avatar.open')}](${url})`);
    embed.setImage(url);
    await interaction.reply({ embeds: [embed] });
  }
};
