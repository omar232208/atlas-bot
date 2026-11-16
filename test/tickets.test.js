'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const NS = 'tickets';
const ROOT = path.join(__dirname, '..');
const MOD_DIR = path.join(ROOT, 'src', 'modules', NS);
const LANGS = ['ar', 'en'];

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, `${NS}.json`), 'utf8'));
const sources = () => {
  const out = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) f.isDirectory() ? walk(path.join(dir, f.name)) : f.name.endsWith('.js') && out.push(fs.readFileSync(path.join(dir, f.name), 'utf8')); };
  walk(MOD_DIR);
  return out.join('\n');
};

const { formatChannelName, countOpen, isStaff, DEFAULTS, getConfig } = require('../src/modules/tickets/lib/util');
const { formatTranscript } = require('../src/modules/tickets/lib/transcript');
const ticketCmd = require('../src/modules/tickets/commands/ticket');
const mod = require('../src/modules/tickets');

test('locale files have identical keys in all languages', () => {
  const ref = flatten(locale('ar')).sort();
  for (const lang of LANGS) assert.deepStrictEqual(flatten(locale(lang)).sort(), ref, `key mismatch in ${lang}`);
});

test('placeholders are the same in every language', () => {
  const fr = locale('ar');
  const get = (o, k) => k.split('.').reduce((a, p) => a[p], o);
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const lang of LANGS) {
    const data = locale(lang);
    for (const key of flatten(fr)) {
      if (key.startsWith('commands.') || key.startsWith('dashboard.help.nameFormat')) continue;
      assert.strictEqual(vars(get(data, key)), vars(get(fr, key)), `${lang}:${key}`);
    }
  }
});

test('every translation key used in the code exists', () => {
  const src = sources();
  const all = new Set(flatten(locale('ar')));
  const keys = new Set();
  for (const m of src.matchAll(/(?:\btr\((?:ctx, [\w.]+, )?|fail\(interaction, ctx, )'([\w.]+)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\$\{NS\}:([a-zA-Z][\w.]+)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\bk\('([\w.]+)'\)/g)) keys.add(`dashboard.${m[1]}`);
  assert.ok(keys.size > 50, `only ${keys.size} keys found`);
  for (const key of keys) if (!key.endsWith('.')) assert.ok(all.has(key), `missing key ${key}`);
});

test('command builds with valid names and localized descriptions under 100 chars', () => {
  const { buildCommandJSON } = require('../src/core/registry');
  const json = buildCommandJSON({ ...ticketCmd, module: NS });
  assert.strictEqual(json.name, 'ticket');
  const check = (opts) => {
    for (const o of opts || []) {
      assert.match(o.name, /^[a-z0-9_-]{1,32}$/);
      assert.ok(o.description && o.description.length <= 100, `description of ${o.name}`);
      for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, `${o.name}: ${v}`);
      assert.ok(o.description !== o.name || o.type === undefined, `option ${o.name} not localized`);
      check(o.options);
    }
  };
  assert.ok(json.description.length <= 100);
  check(json.options);
});

test('module shape', () => {
  assert.strictEqual(mod.name, NS);
  assert.ok(mod.components.every((c) => c.prefix === 'tkt:'));
});

test('dashboard paths are read by the code with the same defaults', () => {
  const src = sources();
  for (const section of mod.dashboard.sections) {
    for (const field of section.fields) {
      assert.ok(field.path.startsWith('tickets.config.'), field.path);
      const key = field.path.slice('tickets.config.'.length);
      assert.ok(Object.prototype.hasOwnProperty.call(DEFAULTS, key), `${key} not in DEFAULTS`);
      assert.deepStrictEqual(field.default, DEFAULTS[key]);
      assert.ok(src.includes(`.${key}`), `${key} never read`);
    }
  }
});

test('getConfig merges stored values over defaults', () => {
  const data = { tickets: { config: { maxOpen: 3 } } };
  const store = { guild: () => ({ get: (p, d) => (p === 'tickets.config' ? data.tickets.config : d) }) };
  const cfg = getConfig(store, '1');
  assert.strictEqual(cfg.maxOpen, 3);
  assert.strictEqual(cfg.nameFormat, DEFAULTS.nameFormat);
});

test('formatChannelName normalises names', () => {
  assert.strictEqual(formatChannelName('ticket-{number}', { number: 7, user: 'Bob' }), 'ticket-0007');
  assert.strictEqual(formatChannelName('{category}-{user}', { number: 1, user: 'Élodie Martin', category: 'Support Tech' }), 'support-tech-elodie-martin');
  assert.strictEqual(formatChannelName('***', { number: 2, user: 'x' }), 'ticket-2');
});

test('countOpen counts only open tickets of the user', () => {
  const list = { a: { ownerId: '1', status: 'open' }, b: { ownerId: '1', status: 'closed' }, c: { ownerId: '2', status: 'open' } };
  assert.strictEqual(countOpen(list, '1'), 1);
  assert.strictEqual(countOpen({}, '1'), 0);
});

test('isStaff by permission or role', () => {
  const member = (roles, manage = false) => ({ permissions: { has: () => manage }, roles: { cache: new Set(roles) } });
  const cfg = { ...DEFAULTS, staffRoleIds: ['10'] };
  assert.ok(isStaff(member(['10']), cfg));
  assert.ok(isStaff(member([], true), cfg));
  assert.ok(isStaff(member(['20']), cfg, { staffRoleId: '20' }));
  assert.ok(!isStaff(member(['30']), cfg));
});

test('formatTranscript writes header and messages', () => {
  const labels = Object.fromEntries(['title', 'server', 'channel', 'opened', 'closed', 'owner', 'category', 'claimed', 'reason', 'messages', 'attachment', 'embed', 'none'].map((k) => [k, k.toUpperCase()]));
  const text = formatTranscript({
    labels,
    guildName: 'Guild',
    channelName: 'ticket-0001',
    ticket: { number: 1, ownerId: '42', ownerTag: 'bob', createdAt: Date.UTC(2026, 0, 1, 10, 0, 0) },
    messages: [
      { createdTimestamp: Date.UTC(2026, 0, 1, 10, 1, 0), author: { tag: 'bob', id: '42', bot: false }, content: 'hello', attachments: ['https://cdn/x.png'], embeds: [] },
      { createdTimestamp: Date.UTC(2026, 0, 1, 10, 2, 0), author: { tag: 'bot', id: '1', bot: true }, content: '', attachments: [], embeds: ['Title - Desc'] }
    ],
    closedAt: Date.UTC(2026, 0, 1, 11, 0, 0)
  });
  assert.match(text, /TITLE #1/);
  assert.match(text, /\[2026-01-01 10:01:00 UTC\] bob: hello/);
  assert.match(text, /ATTACHMENT: https:\/\/cdn\/x.png/);
  assert.match(text, /bot \[BOT\]:/);
  assert.match(text, /EMBED: Title - Desc/);
  assert.match(text, /MESSAGES: 2/);
  assert.match(text, /CATEGORY: NONE/);
});

test('parseEmoji accepts unicode and custom emojis only', () => {
  assert.strictEqual(ticketCmd.parseEmoji('🎫'), '🎫');
  assert.deepStrictEqual(ticketCmd.parseEmoji('<:ticket:123456789012345678>'), { name: 'ticket', id: '123456789012345678', animated: false });
  assert.strictEqual(ticketCmd.parseEmoji('abc'), undefined);
});
