'use strict';

const { SlashCommandBuilder } = require('discord.js');
const en = require('../en');
const tictactoe = require('./tictactoe');
const connect4 = require('./connect4');
const rps = require('./rps');
const hangman = require('./hangman');
const trivia = require('./trivia');

/**
 * Group command: /game tictactoe|connect4|rps|hangman|trivia. Grouping keeps
 * the bot's top-level command count low (Discord allows 100 per bot); each game
 * stays in its own file and is dispatched by subcommand name.
 */
const games = [tictactoe, connect4, rps, hangman, trivia];
const byName = new Map(games.map((g) => [g.data.name, g]));

module.exports = {
  data: games.reduce(
    (group, g) => group.addSubcommand(g.data),
    new SlashCommandBuilder().setName('game').setDescription(en('fun:commands.game.description'))
  ),

  /** Runs the game chosen with the subcommand. */
  async execute(interaction, ctx) {
    return byName.get(interaction.options.getSubcommand()).execute(interaction, ctx);
  }
};
