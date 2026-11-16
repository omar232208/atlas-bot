'use strict';

/**
 * Tic-tac-toe rules, free of any Discord code so they can be unit-tested.
 * A board is a flat array of 9 cells in row-major order: null, 'X' or 'O'.
 */

/** The eight lines (rows, columns, diagonals) that win the game, as cell indexes. */
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

/** @returns {Array<null>} A new empty board. */
function emptyBoard() {
  return Array(9).fill(null);
}

/**
 * Returns a copy of the board with `mark` on `cell`. The input is never mutated,
 * so a rejected move leaves the game state untouched.
 * @param {Array<string|null>} board
 * @param {number} cell 0..8
 * @param {'X'|'O'} mark
 * @returns {Array<string|null>}
 * @throws {RangeError|Error} when the cell or the mark is invalid, or the cell is taken.
 */
function place(board, cell, mark) {
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) throw new RangeError(`cell out of range: ${cell}`);
  if (mark !== 'X' && mark !== 'O') throw new Error(`invalid mark: ${mark}`);
  if (board[cell] !== null) throw new Error(`cell ${cell} is already taken`);
  const next = board.slice();
  next[cell] = mark;
  return next;
}

/**
 * Looks at the whole board for a finished game.
 * @param {Array<string|null>} board
 * @returns {{status: 'playing'|'win'|'draw', mark: string|null, line: number[]|null}}
 */
function evaluate(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] !== null && board[a] === board[b] && board[a] === board[c]) {
      return { status: 'win', mark: board[a], line };
    }
  }
  // Checked after the lines: a full board can still contain a winning line.
  if (board.every((cell) => cell !== null)) return { status: 'draw', mark: null, line: null };
  return { status: 'playing', mark: null, line: null };
}

module.exports = { LINES, emptyBoard, place, evaluate };
