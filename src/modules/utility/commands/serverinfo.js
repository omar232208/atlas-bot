'use strict';

const { SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('server')
    .setDescription(en('utility:commands.info.options.server.description')),

  /** Summary of the server: owner, size, boosts, creation date and security level. */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const guild = interaction.guild;
    const humans = guild.members.cache.filter((m) => !m.user.bot).size;
    const bots = guild.members.cache.filter((m) => m.user.bot).size;
    const fields = [
      { name: t(interaction, 'utility:serverinfo.id'), value: guild.id, inline: true },
      { name: t(interaction, 'utility:serverinfo.owner'), value: `<@${guild.ownerId}>`, inline: true },
      { name: t(interaction, 'utility:serverinfo.created'), value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      { name: t(interaction, 'utility:serverinfo.members'), value: String(guild.memberCount), inline: true },
      { name: t(interaction, 'utility:serverinfo.humans'), value: String(humans), inline: true },
      { name: t(interaction, 'utility:serverinfo.bots'), value: String(bots), inline: true },
      { name: t(interaction, 'utility:serverinfo.channels'), value: String(guild.channels.cache.size), inline: true },
      { name: t(interaction, 'utility:serverinfo.roles'), value: String(guild.roles.cache.size), inline: true },
      { name: t(interaction, 'utility:serverinfo.boosts'), value: `${t(interaction, 'utility:serverinfo.boostLevel', { level: guild.premiumTier })} (${guild.premiumSubscriptionCount ?? 0})`, inline: true },
      { name: t(interaction, 'utility:serverinfo.verification'), value: t(interaction, `utility:serverinfo.verificationLevels.${guild.verificationLevel}`), inline: true }
    ];
    const embed = embeds.info(t(interaction, 'utility:serverinfo.title', { name: guild.name }), null, { fields });
    const icon = guild.iconURL({ size: 256 });
    if (icon) embed.setThumbnail(icon);
    await interaction.reply({ embeds: [embed] });
  }
};
