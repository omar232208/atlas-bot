'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { en, requireMember } = require('../lib/util');

// Grouped under one top-level command to respect Discord's limit of 100
// top-level commands per bot: /community stats|sticky|autoresponder <action>.
const GROUPS = [require('../groups/stats'), require('../groups/sticky'), require('../groups/autoresponder')];
const byName = new Map(GROUPS.map((g) => [g.name, g]));

const data = new SlashCommandBuilder()
  .setName('community')
  .setDescription(en('commands.community.description'))
  // Lowest staff level of the groups; each group then checks its own permission.
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
for (const group of GROUPS) data.addSubcommandGroup(group.build);

module.exports = {
  data,
  /**
   * Routes to the group handler after checking the group's member permission.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const group = byName.get(interaction.options.getSubcommandGroup());
    if (!group) return null;
    if (!(await requireMember(interaction, ctx, group.permission))) return null;
    return group.execute(interaction, ctx);
  },
  /** Autocomplete is only used by groups that define it. */
  async autocomplete(interaction, ctx) {
    const group = byName.get(interaction.options.getSubcommandGroup());
    if (group?.autocomplete) return group.autocomplete(interaction, ctx);
    return interaction.respond([]).catch(() => {});
  }
};
