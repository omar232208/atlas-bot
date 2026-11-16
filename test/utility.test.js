'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_DIR = path.join(ROOT, 'src', 'modules', 'utility');
const LANGS = ['ar', 'en'];

const cache = require('../src/modules/utility/snipe-cache');
const poll = require('../src/modules/utility/poll');
const { SETTINGS, readSetting } = require('../src/modules/utility/settings');
const i18n = require('../src/core/i18n');
const embeds = require('../src/core/embeds');
const mod = require('../src/modules/utility/index.js');

const ctx = { t: i18n.t, embeds };

// ---------- snipe memory ----------

test('snipe: messages are kept per channel, most recent first', () => {
  cache.clear();
  const now = 1_000_000;
  cache.remember('c1', { authorId: '1', authorName: 'a', content: 'first', attachments: [] }, now);
  cache.remember('c1', { authorId: '2', authorName: 'b', content: 'second', attachments: [] }, now + 1);
  cache.remember('c2', { authorId: '3', authorName: 'c', content: 'other', attachments: [] }, now + 1);
  const list = cache.recent('c1', now + 2);
  assert.deepEqual(list.map((e) => e.content), ['second', 'first']);
  assert.equal(cache.recent('c2', now + 2).length, 1);
  cache.clear();
});

test('snipe: entries expire after the TTL and are capped per channel', () => {
  cache.clear();
  const now = 5_000_000;
  for (let i = 0; i < cache.MAX_PER_CHANNEL + 5; i += 1) {
    cache.remember('c', { authorId: '1', authorName: 'a', content: `m${i}`, attachments: [] }, now + i);
  }
  const kept = cache.recent('c', now + 100);
  assert.equal(kept.length, cache.MAX_PER_CHANNEL);
  assert.equal(kept[0].content, `m${cache.MAX_PER_CHANNEL + 4}`);
  assert.deepEqual(cache.recent('c', now + cache.TTL_MS + 1000), []);
  cache.clear();
});

// ---------- polls ----------

const sample = (votes) => ({
  question: 'Q?',
  options: ['Red', 'Blue', 'Green'],
  votes,
  endsAt: Date.now() + 60_000,
  closed: false,
  channelId: '1',
  messageId: '2'
});

test('poll: tally counts each option and reports the leaders', () => {
  const t1 = poll.tally(sample({ a: 0, b: 1, c: 1 }));
  assert.deepEqual(t1.counts, [1, 2, 0]);
  assert.equal(t1.total, 3);
  assert.deepEqual(t1.leaders, [1]);
  const tie = poll.tally(sample({ a: 0, b: 1 }));
  assert.deepEqual(tie.leaders, [0, 1]);
  const none = poll.tally(sample({}));
  assert.equal(none.total, 0);
  assert.deepEqual(none.leaders, []);
});

test('poll: an open poll shows its end time and live buttons carrying the counts', () => {
  const view = poll.pollView(ctx, { guildId: '1' }, 'abc123', sample({ a: 1 }));
  const buttons = view.components[0].components.map((b) => b.toJSON());
  assert.equal(buttons.length, 3);
  assert.equal(buttons[1].custom_id, 'utl:poll:abc123:1');
  assert.equal(buttons[1].label, 'Blue (1)');
  assert.equal(buttons[0].label, 'Red (0)');
  assert.notEqual(buttons[0].disabled, true);
  assert.match(view.embeds[0].toJSON().description, /<t:\d+:R>/);
});

test('poll: a closed poll disables its buttons and announces the winner or a tie', () => {
  const winner = poll.pollView(ctx, { guildId: '1' }, 'abc123', sample({ a: 2, b: 2, c: 0, x: 2 }), true);
  assert.equal(winner.components.length, 1);
  assert.ok(winner.components[0].components.every((b) => b.toJSON().disabled === true));
  assert.match(winner.embeds[0].toJSON().description, /Red/);
  const tie = poll.pollView(ctx, { guildId: '1' }, 'abc123', sample({ a: 0, b: 1 }), true);
  assert.match(tie.embeds[0].toJSON().description, /tie|égalité|empate|Gleichstand/i);
  const empty = poll.pollView(ctx, { guildId: '1' }, 'abc123', sample({}), true);
  assert.match(empty.embeds[0].toJSON().description, /nobody voted|personne n'a voté|nadie votó|niemand hat abgestimmt|ninguém votou/);
});

// ---------- commands, locales, dashboard ----------

test('commands: names are valid and every command builds its JSON', () => {
  const names = new Set();
  for (const command of mod.commands) {
    const json = command.data.toJSON();
    assert.match(json.name, /^[\p{Ll}\p{N}_-]{1,32}$/u, json.name);
    assert.ok(!names.has(json.name), `duplicate ${json.name}`);
    names.add(json.name);
    assert.ok(json.description.length > 0 && json.description.length <= 100, json.name);
  }
  assert.equal(mod.commands.length, 6, 'six top-level commands');
});

test('settings: defaults are the documented ones and out-of-range values fall back', () => {
  assert.equal(readSetting('123456789012345678', 'utility.snipe.enabled'), false);
  assert.equal(readSetting('123456789012345678', 'utility.remind.maxDays'), 365);
  assert.equal(SETTINGS['utility.remind.maxDays'].max, 3650);
  assert.throws(() => readSetting('123456789012345678', 'utility.unknown'), /unknown setting/);
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

const readLocale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, 'utility.json'), 'utf8'));

test('locales: the five languages have identical key sets', () => {
  const reference = flatten(readLocale('ar')).sort();
  for (const lang of LANGS) {
    assert.deepEqual(flatten(readLocale(lang)).sort(), reference, `${lang} differs from fr`);
  }
});

test('locales: every literal utility: key used in the code exists in every language', () => {
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
    const source = fs.readFileSync(file, 'utf8');
    for (const [, key] of source.matchAll(/['`]utility:([A-Za-z0-9.]+)['`]/g)) keys.add(key);
  }
  for (const lang of LANGS) {
    const locale = readLocale(lang);
    for (const key of keys) {
      const value = key.split('.').reduce((cur, part) => (cur ? cur[part] : undefined), locale);
      assert.ok(value !== undefined && value !== null, `${lang}: missing utility:${key}`);
    }
  }
});

test('locales: the channel-type and verification-level names used with a computed key exist', () => {
  for (const lang of LANGS) {
    const locale = readLocale(lang);
    for (const type of ['text', 'voice', 'category', 'announcement', 'forum', 'stage', 'thread', 'other']) {
      assert.equal(typeof locale.channelinfo.types[type], 'string', `${lang} ${type}`);
    }
    for (const level of ['0', '1', '2', '3', '4']) {
      assert.equal(typeof locale.serverinfo.verificationLevels[level], 'string', `${lang} ${level}`);
    }
  }
});

test('dashboard: every field path is read by the code, with the same default, and has labels in every language', () => {
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
  const code = sources.join('\n');
  let fields = 0;
  for (const section of mod.dashboard.sections) {
    for (const field of section.fields) {
      fields += 1;
      // Reads go through readSetting(guild, 'path') or a direct store write (the snipe toggle).
      const read = new RegExp(`readSetting\\([^,]+,\\s*'${field.path.replace(/\./g, '\\.')}'\\)`);
      const written = new RegExp(`set\\('${field.path.replace(/\./g, '\\.')}'`);
      assert.ok(read.test(code) || written.test(code), `${field.path} is never read by the code`);
      assert.equal(field.default, SETTINGS[field.path].default, field.path);
      for (const lang of LANGS) {
        const locale = readLocale(lang);
        for (const key of [field.label, field.help].filter(Boolean)) {
          const [ns, dotted] = key.split(':');
          assert.equal(ns, 'utility');
          const value = dotted.split('.').reduce((cur, part) => (cur ? cur[part] : undefined), locale);
          assert.equal(typeof value, 'string', `${lang}: ${key}`);
        }
      }
    }
  }
  assert.equal(fields, 2);
});
