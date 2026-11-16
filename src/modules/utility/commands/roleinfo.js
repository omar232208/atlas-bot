'use strict';

const { SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('role')
    .setDescription(en('utility:commands.info.options.role.description'))
    .addRoleOption((o) => o.setName('role').setDescription(en('utility:commands.info.options.role.options.role')).setRequired(true)),

  /** Colour, position, members and what the role grants. */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const role = interaction.options.getRole('role', true);
    const yes = t(interaction, 'utility:roleinfo.yes');
    const no = t(interaction, 'utility:roleinfo.no');
    const fields = [
      { name: t(interaction, 'utility:roleinfo.id'), value: role.id, inline: true },
      { name: t(interaction, 'utility:roleinfo.color'), value: role.hexColor, inline: true },
      { name: t(interaction, 'utility:roleinfo.position'), value: String(role.position), inline: true },
      // role.members only lists cached members, so the count can be lower on large servers.
      { name: t(interaction, 'utility:roleinfo.members'), value: String(role.members.size), inline: true },
      { name: t(interaction, 'utility:roleinfo.mentionable'), value: role.mentionable ? yes : no, inline: true },
      { name: t(interaction, 'utility:roleinfo.hoisted'), value: role.hoist ? yes : no, inline: true },
      { name: t(interaction, 'utility:roleinfo.admin'), value: role.permissions.has('Administrator') ? yes : no, inline: true },
      { name: t(interaction, 'utility:roleinfo.permissions'), value: String(role.permissions.toArray().length), inline: true },
      { name: t(interaction, 'utility:roleinfo.created'), value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true }
    ];
    await interaction.reply({ embeds: [embeds.info(t(interaction, 'utility:roleinfo.title', { name: role.name }), role.toString(), { fields })] });
  }
};
