'use strict';

const { ButtonStyle, MessageFlags, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const { emptyBoard, place, evaluate } = require('../games/rules/tictactoe');
const { button, grid } = require('../games/ui');
const tracker = require('../games/tracker');
const { sendChallenge, challengeProblem } = require('../games/challenge');
const { readSetting } = require('../settings');

/** The first challenger plays X, the opponent plays O. */
const MARKS = ['X', 'O'];

/**
 * Builds the board and status text for the current state.
 * @param {object} ctx
 * @param {object} state {board, turn, players, result}
 * @param {object} lang Interaction-like object used for translations.
 * @param {boolean} [closed] When true every cell is disabled (game over).
 */
function view(ctx, state, lang, closed = false) {
  const { t, embeds } = ctx;
  const cells = state.board.map((mark, index) => button({
    id: `fun:ttt:${index}`,
    label: mark ?? '·',
    style: mark === 'X' ? ButtonStyle.Danger : mark === 'O' ? ButtonStyle.Success : ButtonStyle.Secondary,
    disabled: closed || mark !== null
  }));
  const player = state.players[state.turn];
  let embed;
  if (state.result.status === 'win') {
    const winner = state.players[MARKS.indexOf(state.result.mark)];
    embed = embeds.success(t(lang, 'fun:tictactoe.title'), t(lang, 'fun:tictactoe.win', { player: winner.toString(), mark: state.result.mark }));
  } else if (state.result.status === 'draw') {
    embed = embeds.info(t(lang, 'fun:tictactoe.title'), t(lang, 'fun:tictactoe.draw'));
  } else if (state.result.status === 'timeout') {
    embed = embeds.warn(t(lang, 'fun:tictactoe.title'), t(lang, 'fun:tictactoe.timeout'));
  } else {
    embed = embeds.info(t(lang, 'fun:tictactoe.title'), t(lang, 'fun:tictactoe.turn', { player: player.toString(), mark: MARKS[state.turn] }));
  }
  // Three rows of three keep the board readable as a 3x3 grid.
  // Cells are built disabled when the game is closed, so the grid is enough.
  return { embeds: [embed], components: grid(cells, 3) };
}

/**
 * Starts the board once the opponent accepted. The challenge message becomes
 * the game board, so the players keep one message for the whole game.
 */
function startGame(ctx, players, timeoutMs) {
  const state = { board: emptyBoard(), turn: 0, players, result: { status: 'playing' } };
  return (click) => {
    const message = click.message;
    // One entry object for the whole game: every move re-tracks this same object.
    const entry = {
      handle: async (move) => {
        const seat = players.findIndex((p) => p.id === move.user.id);
        if (seat === -1) return tracker.reply(move, ctx.embeds.error(ctx.t(move, 'fun:errors.notPlayer')));
        if (seat !== state.turn) return tracker.reply(move, ctx.embeds.error(ctx.t(move, 'fun:errors.notTurn')));
        const cell = Number(move.customId.split(':')[2]);
        let board;
        try {
          board = place(state.board, cell, MARKS[seat]);
        } catch {
          return tracker.reply(move, ctx.embeds.error(ctx.t(move, 'fun:errors.cellTaken')));
        }
        state.board = board;
        state.result = evaluate(board);
        if (state.result.status !== 'playing') {
          tracker.untrack(message.id);
          return move.update(view(ctx, state, move, true));
        }
        state.turn = 1 - seat;
        tracker.track(message, entry, timeoutMs);
        return move.update(view(ctx, state, move));
      },
      expire: () => {
        state.result = { status: 'timeout' };
        return view(ctx, state, { guildId: message.guildId }, true);
      }
    };
    tracker.track(message, entry, timeoutMs);
    return click.update(view(ctx, state, click));
  };
}

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('tictactoe')
    .setDescription(en('fun:commands.game.options.tictactoe.description'))
    .addUserOption((o) => o.setName('opponent').setDescription(en('fun:commands.game.options.tictactoe.options.opponent')).setRequired(true)),

  async execute(interaction, ctx) {
    const opponent = interaction.options.getUser('opponent', true);
    const problem = challengeProblem(interaction.user, opponent);
    if (problem) {
      return interaction.reply({ embeds: [ctx.embeds.error(ctx.t(interaction, `fun:errors.${problem}`))], flags: MessageFlags.Ephemeral });
    }
    const timeoutMs = readSetting(interaction.guildId, 'fun.games.timeoutMinutes') * 60000;
    return sendChallenge(interaction, ctx, {
      opponent,
      gameKey: 'tictactoe',
      onAccept: startGame(ctx, [interaction.user, opponent], timeoutMs)
    });
  }
};
