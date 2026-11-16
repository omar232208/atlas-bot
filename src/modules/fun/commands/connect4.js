'use strict';

const { ButtonStyle, MessageFlags, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const { COLS, emptyBoard, landingRow, drop, evaluate } = require('../games/rules/connect4');
const { button, rows, disableAll } = require('../games/ui');
const tracker = require('../games/tracker');
const { sendChallenge, challengeProblem } = require('../games/challenge');
const { readSetting } = require('../settings');

/** Red plays first (the challenger), yellow second. */
const PIECES = ['R', 'Y'];
const DISC = { null: '⚪', R: '🔴', Y: '🟡' };
const DIGIT_KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

/** Emoji grid of the board, with a row of column numbers on top. */
function boardText(board) {
  const lines = [];
  for (let row = 0; row < board.length / COLS; row += 1) {
    lines.push(board.slice(row * COLS, row * COLS + COLS).map((cell) => DISC[cell]).join(''));
  }
  return [DIGIT_KEYCAPS.join(''), ...lines].join('\n');
}

/**
 * Board message: one button per column (disabled when full) and a give-up button.
 * Rows of five buttons are built by rows(), so seven columns plus give-up fit in two rows.
 */
function view(ctx, state, lang, closed = false) {
  const { t, embeds } = ctx;
  const columnButtons = Array.from({ length: COLS }, (_, col) => button({
    id: `fun:c4:${col}`,
    label: String(col + 1),
    style: ButtonStyle.Primary,
    disabled: closed || landingRow(state.board, col) === -1
  }));
  const buttons = [...columnButtons, button({ id: 'fun:c4:stop', label: t(lang, 'fun:ui.giveUp'), style: ButtonStyle.Danger, disabled: closed })];
  const names = state.players.map((p) => p.toString());
  const legend = t(lang, 'fun:connect4.legend', { red: names[0], yellow: names[1] });
  let embed;
  if (state.result.status === 'win') {
    const winnerSeat = PIECES.indexOf(state.result.piece);
    embed = embeds.success(t(lang, 'fun:connect4.title'), t(lang, 'fun:connect4.win', { player: names[winnerSeat] }));
  } else if (state.result.status === 'draw') {
    embed = embeds.info(t(lang, 'fun:connect4.title'), t(lang, 'fun:connect4.draw'));
  } else if (state.result.status === 'gaveUp') {
    embed = embeds.warn(t(lang, 'fun:connect4.title'), t(lang, 'fun:connect4.gaveUp', { player: names[state.turn] }));
  } else if (state.result.status === 'timeout') {
    embed = embeds.warn(t(lang, 'fun:connect4.title'), t(lang, 'fun:connect4.timeout'));
  } else {
    embed = embeds.info(t(lang, 'fun:connect4.title'), t(lang, 'fun:connect4.turn', { player: names[state.turn] }));
  }
  embed.setDescription([embed.data.description ?? '', boardText(state.board), legend].filter(Boolean).join('\n\n'));
  return { embeds: [embed], components: closed ? disableAll(buttons) : rows(buttons) };
}

/**
 * Turns the challenge message into the board and handles every move.
 * Discs fall to the lowest free row of the chosen column.
 */
function startGame(ctx, players, timeoutMs) {
  const state = { board: emptyBoard(), turn: 0, players, result: { status: 'playing' } };
  return (click) => {
    const message = click.message;
    const entry = {
      handle: async (move) => {
        const seat = players.findIndex((p) => p.id === move.user.id);
        if (seat === -1) return tracker.reply(move, ctx.embeds.error(ctx.t(move, 'fun:errors.notPlayer')));
        if (seat !== state.turn) return tracker.reply(move, ctx.embeds.error(ctx.t(move, 'fun:errors.notTurn')));
        const action = move.customId.split(':')[2];
        if (action === 'stop') {
          state.result = { status: 'gaveUp' };
          tracker.untrack(message.id);
          return move.update(view(ctx, state, move, true));
        }
        const col = Number(action);
        let next;
        try {
          next = drop(state.board, col, PIECES[seat]);
        } catch {
          return tracker.reply(move, ctx.embeds.error(ctx.t(move, 'fun:errors.columnFull')));
        }
        state.board = next.board;
        state.result = evaluate(next.board);
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
    .setName('connect4')
    .setDescription(en('fun:commands.game.options.connect4.description'))
    .addUserOption((o) => o.setName('opponent').setDescription(en('fun:commands.game.options.connect4.options.opponent')).setRequired(true)),

  async execute(interaction, ctx) {
    const opponent = interaction.options.getUser('opponent', true);
    const problem = challengeProblem(interaction.user, opponent);
    if (problem) {
      return interaction.reply({ embeds: [ctx.embeds.error(ctx.t(interaction, `fun:errors.${problem}`))], flags: MessageFlags.Ephemeral });
    }
    const timeoutMs = readSetting(interaction.guildId, 'fun.games.timeoutMinutes') * 60000;
    return sendChallenge(interaction, ctx, {
      opponent,
      gameKey: 'connect4',
      onAccept: startGame(ctx, [interaction.user, opponent], timeoutMs)
    });
  }
};
