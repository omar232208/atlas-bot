'use strict';

const { SlashCommandBuilder } = require('discord.js');
const en = require('../en');
const choose = require('./choose');
const ship = require('./ship');
const reverse = require('./reverse');
const emojify = require('./emojify');

/**
 * Group command: /fun choose|ship|reverse|emojify. Groups light text toys under
 * one top-level name to stay within the per-bot command budget.
 */
const toys = [choose, ship, reverse, emojify];
const byName = new Map(toys.map((t) => [t.data.name, t]));

module.exports = {
  data: toys.reduce(
    (group, t) => group.addSubcommand(t.data),
    new SlashCommandBuilder().setName('fun').setDescription(en('fun:commands.fun.description'))
  ),

  /** Runs the toy chosen with the subcommand. */
  async execute(interaction, ctx) {
    return byName.get(interaction.options.getSubcommand()).execute(interaction, ctx);
  }
};
