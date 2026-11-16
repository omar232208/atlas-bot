'use strict';

/**
 * Connect 4 rules without Discord code. The board is a flat array of 42 cells,
 * row-major, row 0 at the TOP and row 5 at the bottom; a piece falls to the
 * lowest empty row of its column. Pieces are 'R' and 'Y'.
 */

const ROWS = 6;
const COLS = 7;
const WIN_LENGTH = 4;

/** Directions to scan from each cell: right, down, down-right, down-left. */
const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** @returns {Array<null>} A new empty board. */
function emptyBoard() {
  return Array(ROWS * COLS).fill(null);
}

/**
 * Lowest free row of a column, or -1 when the column is full.
 * @param {Array<string|null>} board
 * @param {number} col 0..6
 */
function landingRow(board, col) {
  if (!Number.isInteger(col) || col < 0 || col >= COLS) throw new RangeError(`column out of range: ${col}`);
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row * COLS + col] === null) return row;
  }
  return -1;
}

/**
 * Drops a piece into a column. Returns a new board; the input is not mutated.
 * @param {Array<string|null>} board
 * @param {number} col 0..6
 * @param {'R'|'Y'} piece
 * @returns {{board: Array<string|null>, row: number}}
 * @throws {Error} when the column is full.
 */
function drop(board, col, piece) {
  if (piece !== 'R' && piece !== 'Y') throw new Error(`invalid piece: ${piece}`);
  const row = landingRow(board, col);
  if (row === -1) throw new Error(`column ${col} is full`);
  const next = board.slice();
  next[row * COLS + col] = piece;
  return { board: next, row };
}

/**
 * Searches the whole board for four pieces of one colour in a line.
 * Scanning every start cell (instead of only the last move) also finds wins
 * in boards built by hand, which keeps the rule easy to test.
 * @param {Array<string|null>} board
 * @returns {{status: 'playing'|'win'|'draw', piece: string|null, cells: number[]|null}}
 */
function evaluate(board) {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const piece = board[row * COLS + col];
      if (piece === null) continue;
      for (const [dr, dc] of DIRECTIONS) {
        const cells = [];
        for (let k = 0; k < WIN_LENGTH; k += 1) {
          const r = row + dr * k;
          const c = col + dc * k;
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
          if (board[r * COLS + c] !== piece) break;
          cells.push(r * COLS + c);
        }
        if (cells.length === WIN_LENGTH) return { status: 'win', piece, cells };
      }
    }
  }
  if (board.every((cell) => cell !== null)) return { status: 'draw', piece: null, cells: null };
  return { status: 'playing', piece: null, cells: null };
}

module.exports = { ROWS, COLS, WIN_LENGTH, emptyBoard, landingRow, drop, evaluate };
