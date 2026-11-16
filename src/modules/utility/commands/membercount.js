'use strict';

const { SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('members')
    .setDescription(en('utility:commands.info.options.members.description')),

  /**
   * Total comes from Discord (always exact). The human/bot split uses the
   * members the bot has cached, so it is flagged as partial when the cache is
   * smaller than the server.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const guild = interaction.guild;
    const cached = guild.members.cache;
    const bots = cached.filter((m) => m.user.bot).size;
    const humans = cached.size - bots;
    const partial = cached.size < guild.memberCount;
    const fields = [
      { name: t(interaction, 'utility:membercount.total'), value: String(guild.memberCount), inline: true },
      { name: t(interaction, 'utility:membercount.humans'), value: String(humans), inline: true },
      { name: t(interaction, 'utility:membercount.bots'), value: String(bots), inline: true }
    ];
    const description = partial ? t(interaction, 'utility:membercount.partial') : null;
    await interaction.reply({ embeds: [embeds.info(t(interaction, 'utility:membercount.title', { name: guild.name }), description, { fields })] });
  }
};
