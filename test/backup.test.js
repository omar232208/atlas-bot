'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const NS = 'backup';
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

const { ChannelType, OverwriteType } = require('discord.js');
const snapshot = require('../src/modules/backup/lib/snapshot');
const { planDeletion, countSteps } = require('../src/modules/backup/lib/restore');
const auto = require('../src/modules/backup/lib/auto');
const backups = require('../src/modules/backup/lib/store');
const backupCmd = require('../src/modules/backup/commands/backup');
const mod = require('../src/modules/backup');
const { createStore } = require('../src/core/store');

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
      if (key.startsWith('commands.') || false) continue;
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

test('command builds with localized names, descriptions and choices', () => {
  const { buildCommandJSON } = require('../src/core/registry');
  const json = buildCommandJSON({ ...backupCmd, module: NS });
  assert.strictEqual(json.name, 'backup');
  assert.notStrictEqual(json.description, 'Server backups');
  const check = (opts) => {
    for (const o of opts || []) {
      assert.match(o.name, /^[a-z0-9_-]{1,32}$/);
      assert.ok(o.description && o.description.length <= 100, o.name);
      assert.notStrictEqual(o.description, o.name, `option ${o.name} not localized`);
      for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, v);
      for (const c of o.choices || []) assert.ok(c.name_localizations?.ar, c.value);
      check(o.options);
    }
  };
  check(json.options);
});

test('module shape and dashboard paths', () => {
  assert.strictEqual(mod.name, NS);
  const src = sources();
  for (const field of mod.dashboard.sections.flatMap((s) => s.fields)) {
    assert.ok(field.path.startsWith('backup.config.'), field.path);
    const key = field.path.slice('backup.config.'.length);
    assert.ok(Object.prototype.hasOwnProperty.call(backups.DEFAULTS, key), key);
    assert.deepStrictEqual(field.default, backups.DEFAULTS[key]);
    assert.ok(src.includes(key) && new RegExp(`\\b${key}\\b`).test(src.replace(/path: '[^']+'/g, '')), `${key} never read`);
  }
});

const coll = (items) => new Map(items.map((i) => [i.id, i]));
const fakeGuild = () => {
  const roles = coll([
    { id: 'g', name: '@everyone', position: 0, permissions: { bitfield: 1n } },
    { id: 'r1', name: 'Admin', color: 1, hoist: true, mentionable: false, position: 3, permissions: { bitfield: 8n } },
    { id: 'r2', name: 'Member', color: 0, hoist: false, mentionable: true, position: 1, permissions: { bitfield: 1024n } },
    { id: 'bot', name: 'Bot', managed: true, position: 4, permissions: { bitfield: 8n } }
  ]);
  const ow = (items) => ({ cache: coll(items) });
  const channels = coll([
    { id: 'c2', type: ChannelType.GuildText, name: 'general', parentId: 'cat', rawPosition: 0, topic: 'hi', permissionOverwrites: ow([{ id: 'r2', type: OverwriteType.Role, allow: { bitfield: 1024n }, deny: { bitfield: 0n } }, { id: 'u1', type: OverwriteType.Member, allow: { bitfield: 0n }, deny: { bitfield: 2048n } }]) },
    { id: 'cat', type: ChannelType.GuildCategory, name: 'Main', parentId: null, rawPosition: 0, permissionOverwrites: ow([]) },
    { id: 'v1', type: ChannelType.GuildVoice, name: 'Voice', parentId: 'cat', rawPosition: 1, bitrate: 64000, userLimit: 5, permissionOverwrites: ow([]) },
    { id: 't1', type: ChannelType.PublicThread, name: 'thread', parentId: 'c2', rawPosition: 0 }
  ]);
  return { id: 'g', name: 'Guild', verificationLevel: 1, explicitContentFilter: 0, defaultMessageNotifications: 1, afkTimeout: 300, afkChannelId: 'v1', systemChannelId: 'c2', iconURL: () => null, roles: { cache: roles }, channels: { cache: channels } };
};

test('serialize keeps structure, skips managed roles and threads', () => {
  const data = snapshot.serialize(fakeGuild());
  assert.ok(snapshot.isValid(data));
  assert.deepStrictEqual(data.roles.map((r) => r.name), ['Admin', 'Member']);
  assert.strictEqual(data.roles[0].permissions, '8');
  assert.deepStrictEqual(data.channels.map((c) => c.key), ['cat', 'c2', 'v1']);
  assert.strictEqual(data.channels[1].parentKey, 'cat');
  assert.strictEqual(data.channels[1].overwrites.length, 2);
  assert.strictEqual(data.guild.everyonePermissions, '1');
  assert.strictEqual(data.guild.afkChannelKey, 'v1');
  const s = snapshot.summarize(data);
  assert.deepStrictEqual({ roles: s.roles, categories: s.categories, text: s.text, voice: s.voice }, { roles: 2, categories: 1, text: 1, voice: 1 });
  assert.ok(s.bytes > 0);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(data)));
});

test('mapOverwrites relinks roles and drops unknown ids', () => {
  const out = snapshot.mapOverwrites([
    { kind: 'role', id: 'old', allow: '1024', deny: '0' },
    { kind: 'role', id: 'missing', allow: '1', deny: '0' },
    { kind: 'member', id: 'here', allow: '0', deny: '2048' },
    { kind: 'member', id: 'gone', allow: '0', deny: '1' }
  ], { roleMap: new Map([['old', 'new']]), hasMember: (id) => id === 'here' });
  assert.deepStrictEqual(out.map((o) => o.id), ['new', 'here']);
  assert.strictEqual(out[0].allow, 1024n);
  assert.strictEqual(out[1].type, OverwriteType.Member);
});

test('isValid rejects broken data', () => {
  assert.ok(!snapshot.isValid(null));
  assert.ok(!snapshot.isValid({ version: 99, guild: {}, roles: [], channels: [] }));
  assert.ok(!snapshot.isValid({ version: 1, guild: {}, roles: null, channels: [] }));
});

test('planDeletion protects everyone, managed, higher roles and the current channel', () => {
  const plan = planDeletion({
    roles: [{ id: 'g', position: 0 }, { id: 'a', position: 2 }, { id: 'm', managed: true, position: 1 }, { id: 'high', position: 9 }],
    channels: [{ id: 'keep' }, { id: 'x' }],
    guildId: 'g', botTop: 5, keepChannelId: 'keep'
  });
  assert.deepStrictEqual(plan, { roles: ['a'], channels: ['x'] });
  assert.strictEqual(countSteps({ roles: [1, 2], channels: [1] }, plan), 2 + 1 + 2 + 1 + 1);
  assert.strictEqual(countSteps({ roles: [], channels: [] }, null), 2);
});

test('pruneIds keeps the newest manual and automatic backups', () => {
  const list = [1, 2, 3, 4].map((n) => ({ id: `m${n}`, createdAt: n, auto: false })).concat([1, 2, 3].map((n) => ({ id: `a${n}`, createdAt: n, auto: true })));
  assert.deepStrictEqual(backups.pruneIds(list, { max: 2, keepAuto: 1 }).sort(), ['a1', 'a2', 'm1', 'm2']);
  assert.deepStrictEqual(backups.pruneIds(list, { max: 10, keepAuto: 10 }), []);
});

test('save, visible, get and remove with a temporary store', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'backup-test-'));
  const store = createStore({ dir, debounceMs: 5 });
  store.guild('1').set('backup.config.maxBackups', 2);
  const data = snapshot.serialize(fakeGuild());
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(backups.save(store, { guildId: '1', guildName: 'G', authorId: 'u', data }).id);
  backups.save(store, { guildId: '2', guildName: 'Other', authorId: 'someone', data });
  assert.strictEqual(Object.values(backups.all(store)).filter((b) => b.guildId === '1').length, 2);
  assert.strictEqual(backups.visible(store, '1', 'u').length, 2);
  assert.strictEqual(backups.visible(store, '3', 'u').length, 2, 'author sees own backups from another server');
  assert.strictEqual(backups.visible(store, '3', 'nobody').length, 0);
  const last = ids[2];
  assert.strictEqual(backups.get(store, last.toUpperCase()).id, last);
  assert.ok(backups.remove(store, last));
  assert.strictEqual(backups.get(store, last), null);
  store.flush();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('automatic backup timing', () => {
  const h = 3600000;
  assert.ok(!auto.isDue(0, 0, Date.now()));
  assert.ok(!auto.isDue(h, 0, Date.now()), 'below the 6 h minimum');
  assert.ok(auto.isDue(24 * h, 0, Date.now()));
  assert.ok(!auto.isDue(24 * h, 1000, 1000 + 23 * h));
  assert.ok(auto.isDue(24 * h, 1000, 1000 + 24 * h));
});

test('ensureTick keeps exactly one tick job', () => {
  const jobs = new Map();
  let n = 0;
  const scheduler = {
    list: (type) => [...jobs.values()].filter((j) => j.type === type),
    schedule: (type, runAt) => { const id = String(++n); jobs.set(id, { id, type, runAt }); return id; },
    cancel: (id) => jobs.delete(id)
  };
  auto.ensureTick(scheduler);
  auto.ensureTick(scheduler);
  scheduler.schedule(auto.JOB, 1);
  auto.ensureTick(scheduler);
  assert.strictEqual(scheduler.list(auto.JOB).length, 1);
});

test('progress bar', () => {
  assert.strictEqual(backupCmd.bar(0.25), '`[#####---------------]` 25%');
});
