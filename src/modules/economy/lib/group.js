'use strict';

const { SlashCommandBuilder, SlashCommandSubcommandBuilder } = require('discord.js');

/**
 * Builds one top-level command whose subcommands are existing leaf commands.
 * Each leaf keeps its own name, description, options and execute(); this only
 * routes the interaction by subcommand name. Discord caps each bot at 100
 * top-level commands, so related leaves are grouped under one name.
 * @param {{name: string, description: string, leaves: Array<{data: SlashCommandBuilder, execute: Function}>}} spec
 * @returns {{data: SlashCommandBuilder, execute: Function}}
 */
function groupCommand({ name, description, leaves }) {
  const data = new SlashCommandBuilder().setName(name).setDescription(description);
  const byName = new Map();
  for (const leaf of leaves) {
    const sub = new SlashCommandSubcommandBuilder()
      .setName(leaf.data.name)
      .setDescription(leaf.data.description);
    sub.options.push(...leaf.data.options);
    data.addSubcommand(sub);
    byName.set(leaf.data.name, leaf);
  }
  return {
    data,
    execute(interaction, ctx) {
      const leaf = byName.get(interaction.options.getSubcommand());
      return leaf.execute(interaction, ctx);
    }
  };
}

module.exports = { groupCommand };
