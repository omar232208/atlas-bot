'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_DIR = path.join(ROOT, 'src', 'modules', 'fun');
const LANGS = ['ar', 'en'];

const ttt = require('../src/modules/fun/games/rules/tictactoe');
const c4 = require('../src/modules/fun/games/rules/connect4');
const rps = require('../src/modules/fun/games/rules/rps');
const hangman = require('../src/modules/fun/games/rules/hangman');
const trivia = require('../src/modules/fun/games/rules/trivia');
const fancy = require('../src/modules/fun/games/rules/fancy');
const { loadBank } = require('../src/modules/fun/games/banks');
const { SETTINGS } = require('../src/modules/fun/settings');
const mod = require('../src/modules/fun/index.js');

/** Places marks from a string like "XX.OO....": '.' is an empty cell. */
const boardFrom = (s) => [...s].map((ch) => (ch === '.' ? null : ch));

// ---------- tic-tac-toe ----------

test('tictactoe: place returns a new board and never mutates the input', () => {
  const board = ttt.emptyBoard();
  const next = ttt.place(board, 4, 'X');
  assert.equal(next[4], 'X');
  assert.equal(board[4], null);
});

test('tictactoe: taken cells, bad cells and bad marks are refused', () => {
  const board = ttt.place(ttt.emptyBoard(), 0, 'X');
  assert.throws(() => ttt.place(board, 0, 'O'), /already taken/);
  assert.throws(() => ttt.place(board, 9, 'O'), RangeError);
  assert.throws(() => ttt.place(board, 1.5, 'O'), RangeError);
  assert.throws(() => ttt.place(board, 1, 'Z'), /invalid mark/);
});

test('tictactoe: every row, column and diagonal is a win', () => {
  assert.equal(ttt.LINES.length, 8);
  for (const line of ttt.LINES) {
    const board = ttt.emptyBoard();
    for (const cell of line) board[cell] = 'X';
    const result = ttt.evaluate(board);
    assert.equal(result.status, 'win', line.join(','));
    assert.deepEqual(result.line, line);
  }
});

test('tictactoe: winner mark is reported correctly for O', () => {
  const result = ttt.evaluate(boardFrom('OOO.XX...'));
  assert.deepEqual(result, { status: 'win', mark: 'O', line: [0, 1, 2] });
});

test('tictactoe: full board without a line is a draw, partial board is playing', () => {
  assert.equal(ttt.evaluate(boardFrom('XOXXOOOXX')).status, 'draw');
  assert.equal(ttt.evaluate(boardFrom('XO.......')).status, 'playing');
});

// ---------- connect 4 ----------

test('connect4: a disc falls to the lowest free row of its column', () => {
  let board = c4.emptyBoard();
  let res = c4.drop(board, 3, 'R');
  assert.equal(res.row, 5);
  board = res.board;
  res = c4.drop(board, 3, 'Y');
  assert.equal(res.row, 4);
  assert.equal(board[5 * 7 + 3], 'R', 'input board is not mutated');
});

test('connect4: a full column is refused and reported by landingRow', () => {
  let board = c4.emptyBoard();
  for (let i = 0; i < 6; i += 1) board = c4.drop(board, 0, i % 2 ? 'Y' : 'R').board;
  assert.equal(c4.landingRow(board, 0), -1);
  assert.throws(() => c4.drop(board, 0, 'R'), /is full/);
  assert.throws(() => c4.drop(c4.emptyBoard(), 7, 'R'), RangeError);
});

/** Builds a board from six strings of seven characters, top row first. */
const grid = (rows) => rows.join('').split('').map((ch) => (ch === '.' ? null : ch));

test('connect4: horizontal, vertical and both diagonal wins are detected', () => {
  const horizontal = grid([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    'RRRR...'
  ]);
  const vertical = grid([
    '.......',
    '.......',
    '.Y.....',
    '.Y.....',
    '.Y.....',
    '.Y.....'
  ]);
  const diagonalDown = grid([
    '.......',
    '.......',
    'R......',
    '.R.....',
    '..R....',
    '...R...'
  ]);
  const diagonalUp = grid([
    '.......',
    '.......',
    '...Y...',
    '..Y....',
    '.Y.....',
    'Y......'
  ]);
  const h = c4.evaluate(horizontal);
  assert.equal(h.status, 'win');
  assert.equal(h.piece, 'R');
  assert.equal(h.cells.length, 4);
  assert.equal(c4.evaluate(vertical).status, 'win');
  assert.equal(c4.evaluate(diagonalDown).status, 'win');
  assert.equal(c4.evaluate(diagonalUp).status, 'win');
});

test('connect4: three in a row is not a win, and the win is found anywhere on the board', () => {
  const three = grid([
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    'RRR....'
  ]);
  assert.equal(c4.evaluate(three).status, 'playing');
  const wallWin = grid([
    '......Y',
    '.....YR',
    '....YRR',
    '...YRRR',
    '..YRRRR',
    '.YRRRRY'
  ]);
  assert.equal(c4.evaluate(wallWin).status, 'win');
});

test('connect4: a full board without a line is a draw', () => {
  // Columns alternate in blocks of three so no four in a row can form.
  const rowsOfDraw = [
    'RRYYRRY',
    'YYRRYYR',
    'RRYYRRY',
    'YYRRYYR',
    'RRYYRRY',
    'YYRRYYR'
  ];
  assert.equal(c4.evaluate(grid(rowsOfDraw)).status, 'draw');
});

// ---------- rock-paper-scissors ----------

test('rps: every pair resolves to the expected side', () => {
  assert.equal(rps.resolve('rock', 'scissors'), 'a');
  assert.equal(rps.resolve('scissors', 'paper'), 'a');
  assert.equal(rps.resolve('paper', 'rock'), 'a');
  assert.equal(rps.resolve('scissors', 'rock'), 'b');
  assert.equal(rps.resolve('rock', 'paper'), 'b');
  assert.equal(rps.resolve('paper', 'scissors'), 'b');
  for (const c of rps.CHOICES) assert.equal(rps.resolve(c, c), 'draw');
  assert.throws(() => rps.resolve('lizard', 'rock'), /unknown choice/);
});

// ---------- hangman ----------

test('hangman: accents are matched without the player typing them', () => {
  const state = hangman.createState('éléphant');
  assert.deepEqual(hangman.lettersOf('éléphant').sort(), ['A', 'E', 'H', 'L', 'N', 'P', 'T']);
  const res = hangman.guess(state, 'e');
  assert.equal(res.outcome, 'hit');
  // Both accented E's appear; the L, P, H, A, N and T stay hidden.
  assert.equal(hangman.masked(res.state), 'é_é_____');
});

test('hangman: hits, misses, repeats and invalid input', () => {
  let state = hangman.createState('chat');
  let res = hangman.guess(state, 'c');
  assert.equal(res.outcome, 'hit');
  state = res.state;
  res = hangman.guess(state, 'z');
  assert.equal(res.outcome, 'miss');
  state = res.state;
  assert.equal(hangman.guess(state, 'c').outcome, 'repeat');
  assert.equal(hangman.guess(state, 'z').outcome, 'repeat');
  assert.equal(hangman.guess(state, '7').outcome, 'invalid');
  assert.equal(hangman.masked(state), 'c___');
});

test('hangman: winning reveals every letter, six mistakes lose the game', () => {
  let state = hangman.createState('nid');
  for (const letter of 'nid') state = hangman.guess(state, letter).state;
  assert.equal(hangman.status(state), 'won');
  assert.equal(hangman.masked(state), 'nid');

  state = hangman.createState('nid');
  for (const letter of 'bcfgjk') state = hangman.guess(state, letter).state;
  assert.equal(state.wrong.length, hangman.MAX_WRONG);
  assert.equal(hangman.status(state), 'lost');
});

test('hangman: spaces and hyphens stay visible in the masked word', () => {
  const state = hangman.createState('pomme de terre');
  assert.equal(hangman.masked(state), '_____ __ _____');
});

test('hangman: a word without letters is refused', () => {
  assert.throws(() => hangman.createState('123'), /needs at least one letter/);
});

// ---------- trivia ----------

test('trivia: every language bank has at least 60 well-formed questions', () => {
  for (const lang of LANGS) {
    const bank = loadBank('trivia', lang);
    assert.ok(bank.length >= 60, `${lang} has ${bank.length} questions`);
    assert.deepEqual(trivia.validateBank(bank), [], `${lang} bank problems`);
  }
});

test('trivia: buildQuestion keeps the correct answer, whatever the shuffle', () => {
  const entry = { q: 'Q?', answers: ['good', 'bad1', 'bad2', 'bad3'] };
  for (let seed = 0; seed < 20; seed += 1) {
    let s = seed + 1;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const question = trivia.buildQuestion(entry, rnd);
    assert.equal(question.options.length, 4);
    assert.equal(question.options[question.correctIndex], 'good');
    assert.deepEqual([...question.options].sort(), [...entry.answers].sort());
  }
});

test('trivia: pickQuestions returns distinct questions and caps at the bank size', () => {
  const bank = loadBank('trivia', 'en');
  const picked = trivia.pickQuestions(bank, 7);
  assert.equal(picked.length, 7);
  assert.equal(new Set(picked.map((q) => q.q)).size, 7);
  assert.equal(trivia.pickQuestions(bank, 500).length, bank.length);
  assert.equal(trivia.pickQuestions(bank, 0).length, 0);
});

test('trivia: validateBank reports broken entries', () => {
  const problems = trivia.validateBank([
    { q: '', answers: ['a', 'b', 'c', 'd'] },
    { q: 'x', answers: ['a', 'a', 'c', 'd'] },
    { q: 'y', answers: ['a', 'b'] }
  ]);
  // One missing question, one duplicate answer, one entry with only two answers.
  assert.equal(problems.length, 3);
});

// ---------- word and text helpers ----------

test('fancy: ship score is symmetric, stable and between 0 and 100', () => {
  const a = fancy.shipScore('111', '222');
  assert.equal(a, fancy.shipScore('222', '111'));
  assert.equal(a, fancy.shipScore('111', '222'));
  for (let i = 0; i < 200; i += 1) {
    const score = fancy.shipScore(String(100000 + i), String(900000 - i * 3));
    assert.ok(score >= 0 && score <= 100, `score ${score}`);
  }
});

test('fancy: verdict thresholds', () => {
  assert.equal(fancy.verdictIndex(0), 0);
  assert.equal(fancy.verdictIndex(19), 0);
  assert.equal(fancy.verdictIndex(20), 1);
  assert.equal(fancy.verdictIndex(59), 2);
  assert.equal(fancy.verdictIndex(60), 3);
  assert.equal(fancy.verdictIndex(85), 4);
  assert.equal(fancy.verdictIndex(100), 4);
});

test('fancy: blended couple name takes the first half of one name and the second half of the other', () => {
  // "Alice" keeps its first 3 letters, "Bob" keeps from index 1.
  assert.equal(fancy.blendNames('Alice', 'Bob'), 'Aliob');
  assert.equal(fancy.blendNames('a', 'b'), 'ab');
});

test('fancy: reverseText keeps accents and emoji clusters intact', () => {
  assert.equal(fancy.reverseText('abc'), 'cba');
  assert.equal(fancy.reverseText('été'), 'été');
  assert.equal(fancy.reverseText('ab👍🏽'), '👍🏽ba');
});

test('fancy: emojify maps letters, accents and digits', () => {
  assert.equal(fancy.emojify('a'), '\u{1F1E6}');
  assert.equal(fancy.emojify('é'), '\u{1F1EA}');
  assert.equal(fancy.emojify('1'), '1️⃣');
  assert.equal(fancy.emojify('a b'), '\u{1F1E6}   \u{1F1E7}');
  assert.equal(fancy.emojify('!'), '!');
});

// ---------- command data, locales and dashboard ----------

test('commands: names are valid and every command builds its JSON', () => {
  const names = new Set();
  for (const command of mod.commands) {
    const json = command.data.toJSON();
    assert.match(json.name, /^[\p{Ll}\p{N}_-]{1,32}$/u, json.name);
    assert.ok(!names.has(json.name), `duplicate ${json.name}`);
    names.add(json.name);
    assert.ok(json.description.length > 0 && json.description.length <= 100, json.name);
    assert.equal(typeof command.execute, 'function', json.name);
  }
  assert.equal(mod.commands.length, 4, 'four top-level commands: 8ball, dice, game, fun');
});

/** Flattens a locale object into dotted keys; array items become numeric segments. */
function flatten(value, prefix = '', out = []) {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.push(prefix);
  }
  return out;
}

const readLocale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, 'fun.json'), 'utf8'));

test('locales: the five languages have identical key sets', () => {
  const reference = flatten(readLocale('ar')).sort();
  for (const lang of LANGS) {
    assert.deepEqual(flatten(readLocale(lang)).sort(), reference, `${lang} differs from fr`);
  }
});

test('locales: the 8-ball has exactly 20 answers in every language', () => {
  for (const lang of LANGS) {
    assert.equal(readLocale(lang).eightball.answers.length, 20, lang);
    assert.equal(readLocale(lang).ship.verdicts.length, 5, lang);
  }
});

test('locales: every literal fun: key used in the code exists in every language', () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(MODULE_DIR);
  const keys = new Set();
  for (const file of files) {
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/['`]fun:([A-Za-z0-9.]+)['`]/g)) keys.add(key);
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/fun:([A-Za-z0-9.]+)\$\{/g)) keys.add(`${key}*`);
  }
  for (const lang of LANGS) {
    const locale = readLocale(lang);
    for (const key of keys) {
      if (key.endsWith('*')) continue;
      const value = key.split('.').reduce((cur, part) => (cur ? cur[part] : undefined), locale);
      assert.ok(value !== undefined, `${lang}: missing fun:${key}`);
    }
  }
});

test('dashboard: every field path is read by the code, with the same default', () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && entry.name !== 'index.js' && entry.name !== 'settings.js') {
        sources.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  walk(MODULE_DIR);
  const readers = sources.join('\n');
  let fields = 0;
  for (const section of mod.dashboard.sections) {
    for (const field of section.fields) {
      fields += 1;
      const pattern = new RegExp(`readSetting\\([^,]+,\\s*'${field.path.replace(/\./g, '\\.')}'\\)`);
      assert.match(readers, pattern, `${field.path} is never read by the code`);
      assert.equal(field.default, SETTINGS[field.path].default, field.path);
      for (const lang of LANGS) {
        const locale = readLocale(lang);
        for (const key of [field.label, field.help]) {
          const [ns, dotted] = key.split(':');
          assert.equal(ns, 'fun');
          const value = dotted.split('.').reduce((cur, part) => (cur ? cur[part] : undefined), locale);
          assert.equal(typeof value, 'string', `${lang}: ${key}`);
        }
      }
    }
  }
  assert.ok(fields >= 2);
});

test('banks: every word file is non-empty and every word has letters only', () => {
  for (const lang of LANGS) {
    const words = loadBank('words', lang);
    assert.ok(words.length >= 50, `${lang} has ${words.length} words`);
    for (const word of words) {
      assert.match(word, /^[\p{L}-]+$/u, `${lang}: ${word}`);
    }
  }
});
