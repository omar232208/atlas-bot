'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NS = 'logs';
const ROOT = path.join(__dirname, '..');
const MOD_DIR = path.join(ROOT, 'src', 'modules', NS);
const LANGS = ['ar', 'en'];

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, `${NS}.json`), 'utf8'));
const lookup = (obj, key) => key.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), obj);
const sources = () => {
  const out = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) f.isDirectory() ? walk(path.join(dir, f.name)) : f.name.endsWith('.js') && out.push(fs.readFileSync(path.join(dir, f.name), 'utf8')); };
  walk(MOD_DIR);
  return out.join('\n');
};
const hasKey = (fullKey) => {
  const [ns, key] = fullKey.split(':');
  return LANGS.every((lang) => typeof lookup(JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, `${ns}.json`), 'utf8')), key) === 'string');
};

const { createStore } = require('../src/core/store');
const registry = require('../src/core/registry');
const config = require('../src/modules/logs/lib/config');
const invites = require('../src/modules/logs/lib/invites');
const format = require('../src/modules/logs/lib/format');
const { voiceChange } = require('../src/modules/logs/events/voice');
const { changes } = require('../src/modules/logs/events/server');
const mod = require('../src/modules/logs');

const tmpStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'logs-test-')), debounceMs: 60000 });

test('locale files have identical keys and placeholders in all languages', () => {
  const fr = locale('ar');
  const ref = flatten(fr).sort();
  const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
  for (const lang of LANGS) {
    const data = locale(lang);
    assert.deepStrictEqual(flatten(data).sort(), ref, `key mismatch in ${lang}`);
    for (const key of ref) assert.strictEqual(vars(lookup(data, key)), vars(lookup(fr, key)), `${lang}:${key}`);
  }
});

test('every literal translation key used in the code exists', () => {
  const keys = [...sources().matchAll(/['`](logs:[\w.]+)['`]/g)].map((m) => m[1]);
  assert.ok(keys.length > 50);
  for (const key of new Set(keys)) assert.ok(hasKey(key), `missing ${key}`);
  for (const c of config.CATEGORIES) assert.ok(hasKey(`logs:categories.${c}`));
  for (const kind of ['join', 'leave', 'move', 'mute', 'unmute', 'deaf', 'undeaf']) {
    assert.ok(hasKey(`logs:events.voice.${kind}`) && hasKey(`logs:events.voice.${kind}Desc`));
  }
});

test('command data is valid and localized within Discord limits', () => {
  assert.strictEqual(mod.name, NS);
  for (const cmd of mod.commands) {
    const json = registry.buildCommandJSON({ ...cmd, module: NS });
    assert.match(json.name, /^[a-z0-9_-]{1,32}$/);
    const check = (o) => {
      assert.ok(o.description.length >= 1 && o.description.length <= 100, o.name);
      for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, `${o.name}: ${v}`);
      for (const ch of o.choices || []) for (const v of Object.values(ch.name_localizations || {})) assert.ok(v.length <= 100);
      (o.options || []).forEach(check);
    };
    check(json);
    assert.strictEqual(json.description_localizations.ar, locale('ar').commands.logs.description);
  }
});

test('dashboard schema uses the paths and defaults the code reads', () => {
  const readable = new Set([...config.CATEGORIES.map((c) => config.PATHS.channel(c)), config.PATHS.ignored, config.PATHS.ignoreBots]);
  const store = tmpStore();
  const g = store.guild('1');
  for (const section of mod.dashboard.sections) {
    assert.ok(hasKey(section.title));
    for (const f of section.fields) {
      assert.ok(readable.has(f.path), `unknown path ${f.path}`);
      assert.ok(hasKey(f.label), f.label);
      if (f.help) assert.ok(hasKey(f.help), f.help);
    }
  }
  // A value written at a dashboard path must change what the code does.
  const field = mod.dashboard.sections[0].fields.find((f) => f.path === 'logs.channels.voice');
  g.set(field.path, '42');
  assert.strictEqual(config.channelIdFor(g.get, 'voice'), '42');
  g.set('logs.ignored', ['7']);
  assert.ok(config.isIgnoredChannel(g.get, '7'));
  assert.strictEqual(mod.dashboard.sections[1].fields.find((f) => f.path === 'logs.ignoreBots').default, config.DEFAULTS.ignoreBots);
  for (const a of mod.dashboard.actions) assert.ok(hasKey(a.label));
});

test('categories: aliases and moderation fallback', () => {
  assert.strictEqual(config.canonical('antinuke'), 'protection');
  assert.strictEqual(config.canonical('Verification'), 'members');
  const data = { 'logs.channels.moderation': 'm', 'logs.channels.members': 'mem' };
  const get = (p, d) => (p in data ? data[p] : d);
  assert.strictEqual(config.channelIdFor(get, 'automod'), 'm');
  assert.strictEqual(config.channelIdFor(get, 'tickets'), 'm');
  assert.strictEqual(config.channelIdFor(get, 'verification'), 'mem');
  assert.strictEqual(config.channelIdFor(get, 'voice'), null);
  assert.ok(config.isIgnoredChannel(get, 'm'), 'log channels are never logged');
  assert.ok(!config.isIgnoredChannel(get, 'x'));
});

test('invite tracker finds the used invite', () => {
  const before = invites.snapshot([{ code: 'a', uses: 1, maxUses: 0, inviterId: 'u1' }, { code: 'b', uses: 4, maxUses: 5, inviter: { id: 'u2' } }]);
  const grown = invites.snapshot([{ code: 'a', uses: 2, maxUses: 0, inviterId: 'u1' }, { code: 'b', uses: 4, maxUses: 5, inviterId: 'u2' }]);
  assert.deepStrictEqual(invites.findUsedInvite(before, grown), { code: 'a', uses: 2, inviterId: 'u1' });
  // "b" reached its max uses and Discord deleted it.
  const consumed = invites.snapshot([{ code: 'a', uses: 1, maxUses: 0, inviterId: 'u1' }]);
  assert.deepStrictEqual(invites.findUsedInvite(before, consumed), { code: 'b', uses: 5, inviterId: 'u2' });
  const ambiguous = invites.snapshot([{ code: 'a', uses: 2, maxUses: 0 }, { code: 'b', uses: 5, maxUses: 6 }]);
  assert.strictEqual(invites.findUsedInvite(before, ambiguous), null);
  assert.strictEqual(invites.findUsedInvite(before, before), null);
  const fresh = invites.snapshot([...before.entries()].map(([code, v]) => ({ code, ...v })).concat({ code: 'c', uses: 1, maxUses: 0, inviterId: 'u3' }));
  assert.strictEqual(invites.findUsedInvite(before, fresh).code, 'c');
});

test('invite stats count joins and leaves per inviter', () => {
  const g = tmpStore().guild('5');
  invites.recordJoin(g, 'm1', { type: 'invite', code: 'a', inviterId: 'u1' });
  invites.recordJoin(g, 'm2', { type: 'invite', code: 'a', inviterId: 'u1' });
  invites.recordJoin(g, 'm3', { type: 'invite', code: 'z', inviterId: 'u2' });
  invites.recordJoin(g, 'm4', { type: 'vanity', code: 'v' });
  assert.deepStrictEqual(invites.recordLeave(g, 'm1').inviterId, 'u1');
  assert.strictEqual(invites.recordLeave(g, 'unknown'), null);
  assert.strictEqual(invites.recordLeave(g, 'm4').inviterId, null);
  const stats = invites.getInviteStats(g);
  assert.deepStrictEqual(stats, [{ userId: 'u1', joins: 2, left: 1, net: 1 }, { userId: 'u2', joins: 1, left: 0, net: 1 }]);
});

test('voice change detection', () => {
  assert.strictEqual(voiceChange({ channelId: null }, { channelId: '1' }), 'join');
  assert.strictEqual(voiceChange({ channelId: '1' }, { channelId: null }), 'leave');
  assert.strictEqual(voiceChange({ channelId: '1' }, { channelId: '2' }), 'move');
  assert.strictEqual(voiceChange({ channelId: '1', serverMute: false }, { channelId: '1', serverMute: true }), 'mute');
  assert.strictEqual(voiceChange({ channelId: '1', serverDeaf: true }, { channelId: '1', serverDeaf: false }), 'undeaf');
  assert.strictEqual(voiceChange({ channelId: '1', selfMute: false }, { channelId: '1', selfMute: true }), null);
});

test('formatting helpers', () => {
  assert.strictEqual(format.truncate('abcdef', 4), 'abc…');
  assert.strictEqual(format.truncate('ab', 4), 'ab');
  assert.ok(!format.block('x```y').slice(3, -3).includes('```'));
  assert.deepStrictEqual(format.diffLists(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'] });
  assert.deepStrictEqual(format.diffPermissions(0n, 8n), { added: ['Administrator'], removed: [] });
  assert.strictEqual(format.stamp(1700000000999), '<t:1700000000:R>');
  assert.strictEqual(format.roleList([]), '-');
  const text = format.transcript([
    { createdTimestamp: 2000, author: { tag: 'b', id: '2' }, content: 'second' },
    { createdTimestamp: 1000, author: { username: 'a', id: '1' }, content: 'first', attachments: new Map([['x', { url: 'http://f' }]]) }
  ]);
  assert.match(text.split('\n')[0], /a \(1\): first \[http:\/\/f\]$/);
  assert.deepStrictEqual(changes([['Name', 'a', 'b'], ['Topic', 'x', 'x']]), ['**Name**: a → b']);
});

test('sender routes, checks permissions and never pings', async () => {
  const store = tmpStore();
  const g = store.guild('9');
  g.set('logs.channels.moderation', 'c1');
  const sent = [];
  const channel = { name: 'logs', isTextBased: () => true, permissionsFor: () => ({ has: () => true }), send: async (p) => { sent.push(p); return { id: 'msg' }; } };
  const guild = { id: '9', members: { me: {} }, channels: { cache: new Map([['c1', channel]]) } };
  const warnings = [];
  const send = config.createSender({ store, logger: { warn: (m) => warnings.push(m) } });
  const { EmbedBuilder } = require('discord.js');
  assert.deepStrictEqual(await send(guild, 'antinuke', new EmbedBuilder().setTitle('x')), { id: 'msg' });
  assert.deepStrictEqual(sent[0].allowedMentions, { parse: [] });
  assert.ok(sent[0].embeds[0].data.timestamp);
  assert.strictEqual(await send(guild, 'voice', new EmbedBuilder()), null);
  channel.permissionsFor = () => ({ has: () => false });
  assert.strictEqual(await send(guild, 'moderation', new EmbedBuilder()), null);
  assert.strictEqual(await send(guild, 'moderation', new EmbedBuilder()), null);
  assert.strictEqual(warnings.length, 1, 'permission warning is logged once');
});
