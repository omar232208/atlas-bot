'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../src/core/store');
const i18n = require('../src/core/i18n');
const { buildCommandJSON } = require('../src/core/registry');
const levels = require('../src/modules/levels/index.js');
const xp = require('../src/modules/levels/lib/xp');
const { awardMessage, getProgress, rankOf } = require('../src/modules/levels/lib/ledger');
const { isEnabled, getConfig, DEFAULTS, LIMITS } = require('../src/modules/levels/lib/settings');
const { grantRewards } = require('../src/modules/levels/lib/rewards');

const MODULE_DIR = path.join(__dirname, '..', 'src', 'modules', 'levels');
const LOCALES = path.join(__dirname, '..', 'locales');
const LANGS = ['ar', 'en'];

const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
const tempStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-lvl-')), debounceMs: 0 });
const CFG = { cooldown: 60, xpMin: 15, xpMax: 25 };

// ---------- XP curve ----------

test('xpForLevel follows the MEE6 formula 5l^2 + 50l + 100', () => {
  assert.equal(xp.xpForLevel(0), 100);
  assert.equal(xp.xpForLevel(1), 155);
  assert.equal(xp.xpForLevel(2), 220);
  assert.equal(xp.xpForLevel(10), 1100);
});

test('totalXpForLevel (closed form) equals the sum of xpForLevel for every level up to 80', () => {
  let sum = 0;
  assert.equal(xp.totalXpForLevel(0), 0);
  for (let level = 1; level <= 80; level++) {
    sum += xp.xpForLevel(level - 1);
    assert.equal(xp.totalXpForLevel(level), sum, `level ${level}`);
  }
});

test('known thresholds: level 1 at 100 XP, level 2 at 255 XP', () => {
  assert.equal(xp.totalXpForLevel(1), 100);
  assert.equal(xp.totalXpForLevel(2), 255);
});

test('levelFromXp switches exactly at the thresholds', () => {
  assert.equal(xp.levelFromXp(0), 0);
  assert.equal(xp.levelFromXp(99), 0);
  assert.equal(xp.levelFromXp(100), 1);
  assert.equal(xp.levelFromXp(254), 1);
  assert.equal(xp.levelFromXp(255), 2);
  assert.equal(xp.levelFromXp(xp.totalXpForLevel(50) - 1), 49);
  assert.equal(xp.levelFromXp(xp.totalXpForLevel(50)), 50);
});

test('progress splits total XP into level and position inside the level', () => {
  assert.deepEqual(xp.progress(265), { level: 2, current: 10, required: 220 });
  assert.deepEqual(xp.progress(0), { level: 0, current: 0, required: 100 });
});

test('progressBar fills proportionally and clamps', () => {
  assert.equal(xp.progressBar(0.5, 10), '█████░░░░░');
  assert.equal(xp.progressBar(0, 4), '░░░░');
  assert.equal(xp.progressBar(2, 4), '████');
});

// ---------- ledger ----------

test('awardMessage respects the cooldown and reports level-ups', () => {
  const s = tempStore();
  const t0 = 1_000_000;
  const first = awardMessage(s, '900', '1', CFG, t0, seq([0]));
  assert.deepEqual(first, { awarded: true, from: 0, to: 0 });
  assert.equal(getProgress(s, '900', '1').xp, 15);
  assert.equal(awardMessage(s, '900', '1', CFG, t0 + 10_000, seq([0])).awarded, false, 'inside the cooldown');
  assert.equal(getProgress(s, '900', '1').xp, 15);
  assert.equal(awardMessage(s, '900', '1', CFG, t0 + 61_000, seq([0])).awarded, true, 'after the cooldown');
  assert.equal(getProgress(s, '900', '1').xp, 30);
});

test('awardMessage reports the level before and after a message that crosses a threshold', () => {
  const s = tempStore();
  s.guild('900').set('levels.users.2', { xp: 250, last: 0 });
  const r = awardMessage(s, '900', '2', CFG, 10 ** 9, seq([0]));
  assert.deepEqual(r, { awarded: true, from: 1, to: 2 });
});

test('awardMessage gains between min and max, swapped bounds included', () => {
  const s = tempStore();
  for (let i = 0; i < 50; i++) awardMessage(s, '900', `r${i}`, { cooldown: 0, xpMin: 25, xpMax: 15 }, 0, Math.random);
  for (let i = 0; i < 50; i++) {
    const xp = getProgress(s, '900', `r${i}`).xp;
    assert.ok(xp >= 15 && xp <= 25, `xp ${xp}`);
  }
});

test('rankOf orders members by XP, 1 being the most active', () => {
  const s = tempStore();
  s.guild('900').set('levels.users', { a: { xp: 500 }, b: { xp: 300 }, c: { xp: 300 } });
  assert.equal(rankOf(s, '900', 'a'), 1);
  assert.equal(rankOf(s, '900', 'b'), 2);
  assert.equal(rankOf(s, '900', 'c'), 2);
  assert.equal(rankOf(s, '900', 'nobody'), 4);
});

// ---------- settings ----------

test('levels are off by default and turn on from the stored flag', () => {
  const s = tempStore();
  assert.equal(isEnabled(s, '901'), false);
  s.guild('901').set('levels.enabled', true);
  assert.equal(isEnabled(s, '901'), true);
  assert.deepEqual(getConfig(s, '901'), DEFAULTS);
});

test('getConfig merges stored values over defaults', () => {
  const s = tempStore();
  s.guild('902').set('levels.config', { cooldown: 120, announce: false, announceChannel: null });
  const cfg = getConfig(s, '902');
  assert.equal(cfg.cooldown, 120);
  assert.equal(cfg.announce, false);
  assert.equal(cfg.announceChannel, null);
  assert.equal(cfg.xpMax, DEFAULTS.xpMax);
});

// ---------- rewards ----------

test('grantRewards gives the roles of the levels crossed, skipping roles the bot cannot give', async () => {
  const s = tempStore();
  s.guild('903').set('levels.rewards', { 5: 'r5', 10: 'r10', 20: 'rTooHigh' });
  const roles = new Map([
    ['r5', { id: 'r5', position: 2, managed: false }],
    ['r10', { id: 'r10', position: 3, managed: false }],
    ['rTooHigh', { id: 'rTooHigh', position: 50, managed: false }]
  ]);
  const guild = {
    id: '903',
    roles: { cache: roles },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 10 } } } }
  };
  const added = [];
  const member = { roles: { cache: new Map() } };
  member.roles.add = async (roleId) => { added.push(roleId); };
  const ctx = { store: s, logger: { warn() {} } };

  await grantRewards(ctx, guild, member, 4, 5);
  assert.deepEqual(added, ['r5'], 'level 5 crossed');
  added.length = 0;
  await grantRewards(ctx, guild, member, 9, 12);
  assert.deepEqual(added, ['r10'], 'level 10 crossed');
  added.length = 0;
  await grantRewards(ctx, guild, member, 19, 25);
  assert.deepEqual(added, [], 'a role above the bot is not attempted');
  added.length = 0;
  await grantRewards(ctx, guild, member, 0, 3);
  assert.deepEqual(added, [], 'no reward in range');
});

// ---------- command data, dashboard, locales ----------

test('dashboard: each field path is read by the code (a stored value changes the config)', () => {
  const schema = levels.dashboard.sections[0];
  const s = tempStore();
  for (const field of schema.fields) {
    if (field.path === 'levels.enabled') {
      assert.equal(field.default, false);
      s.guild('904').set(field.path, true);
      assert.equal(isEnabled(s, '904'), true, 'code does not read levels.enabled');
      continue;
    }
    const key = field.path.replace(/^levels\.config\./, '');
    assert.match(field.path, /^levels\.config\.\w+$/);
    assert.deepEqual(field.default, DEFAULTS[key], `default of ${field.path}`);
    let value;
    if (field.type === 'boolean') value = !field.default;
    else if (field.type === 'channel') value = '555555555555555555';
    else value = field.min + 1;
    s.guild('904').set(field.path, value);
    assert.equal(getConfig(s, '904')[key], value, `code does not read ${field.path}`);
  }
});

test('dashboard: numeric bounds match the limits used by the command', () => {
  for (const field of levels.dashboard.sections[0].fields.filter((f) => f.type === 'number')) {
    const key = field.path.replace(/^levels\.config\./, '');
    assert.deepEqual([field.min, field.max], LIMITS[key]);
  }
});

test('every command builds valid, localized Discord JSON', () => {
  const names = new Set();
  for (const cmd of levels.commands) {
    cmd.module = 'levels';
    const json = buildCommandJSON(cmd);
    assert.match(json.name, /^[-_a-z0-9]{1,32}$/);
    assert.ok(json.description_localizations?.ar, `${json.name} has no French description`);
    names.add(json.name);
  }
  assert.deepEqual([...names].sort(), ['leaderboard', 'levels', 'rank']);
  const config = buildCommandJSON(levels.commands.find((c) => c.data.name === 'levels')).options
    .find((o) => o.name === 'config');
  assert.ok(config.options.every((o) => o.description_localizations?.ar), 'config options are localized');
});

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

test('locale files: the five languages have identical key sets', () => {
  const sets = LANGS.map((lang) => new Set(flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, lang, 'levels.json'), 'utf8')))));
  for (let i = 1; i < LANGS.length; i++) assert.deepEqual([...sets[i]].sort(), [...sets[0]].sort(), `${LANGS[i]} differs from fr`);
});

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('every translation key used in the source exists in all five languages', () => {
  const keys = new Set();
  for (const file of sourceFiles(MODULE_DIR)) {
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/'(levels:[A-Za-z0-9_.-]+)'/g)) keys.add(key);
  }
  assert.ok(keys.size > 40);
  for (const key of keys) for (const lang of LANGS) assert.ok(i18n.has(lang, key), `${lang} is missing ${key}`);
});

test('no single-quoted literal uses the levels. prefix except the store paths', () => {
  // A translation written as 'levels.x.y' (no colon) would render as the raw key.
  const allowed = new Set(['levels.enabled', 'levels.config', 'levels.rewards', 'levels.users']);
  for (const file of sourceFiles(MODULE_DIR)) {
    for (const [, lit] of fs.readFileSync(file, 'utf8').matchAll(/'(levels\.[A-Za-z0-9_.]+)'/g)) {
      if (/^levels\.config\.\w+$/.test(lit)) continue; // dashboard schema paths
      assert.ok(allowed.has(lit), `${path.basename(file)}: "${lit}" is a translation key missing its colon`);
    }
  }
});
