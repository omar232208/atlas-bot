'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'antiraid-'));

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const logic = require('../src/modules/antiraid/logic');
const lockdown = require('../src/modules/antiraid/lockdown');
const { rolesToKeep } = require('../src/modules/antiraid/raid');
const mod = require('../src/modules/antiraid');
const { buildCommandJSON } = require('../src/core/registry');
const { createStore } = require('../src/core/store');

const ROOT = path.join(__dirname, '..');
const LANGS = ['ar', 'en'];
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, 'antiraid.json'), 'utf8'));
const flatten = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));
const fakeStore = (data = {}) => {
  const reads = [];
  return { reads, get: (p, d) => { reads.push(p); return p in data ? data[p] : d; } };
};

test('readConfig applies defaults and coerces bad values', () => {
  const cfg = logic.readConfig(fakeStore({ 'antiraid.joinThreshold': 'abc', 'antiraid.joinWindowSec': 99999, 'antiraid.raidAction': 'explode', 'antiraid.enabled': true }));
  assert.strictEqual(cfg.joinThreshold, logic.SETTINGS.joinThreshold.default);
  assert.strictEqual(cfg.joinWindowSec, logic.SETTINGS.joinWindowSec.max);
  assert.strictEqual(cfg.raidAction, 'kick');
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.antiBot, true);
});

test('sliding join window forgets old joins', () => {
  let now = 1000;
  const w = logic.createWindow({ now: () => now });
  assert.strictEqual(w.hit('g', 10000, 'a').length, 1);
  now += 5000;
  assert.deepStrictEqual(w.hit('g', 10000, 'b'), ['a', 'b']);
  now += 6000;
  assert.deepStrictEqual(w.hit('g', 10000, 'c'), ['b', 'c']);
  assert.deepStrictEqual(w.peek('g', 1000), ['c']);
  w.clear('g');
  assert.deepStrictEqual(w.peek('g', 10000), []);
});

test('window memory is bounded', () => {
  const w = logic.createWindow({ maxKeys: 3 });
  for (const k of ['a', 'b', 'c', 'd']) w.hit(k, 1000, 1);
  assert.strictEqual(w.size, 3);
});

test('join filters and raid threshold', () => {
  const cfg = { ...logic.readConfig(fakeStore()), minAccountAgeMs: 86400000, noAvatar: true, joinThreshold: 5 };
  const now = 10 * 86400000;
  assert.strictEqual(logic.joinVerdict(cfg, { createdAt: now - 3600000, hasAvatar: true }, now), 'accountAge');
  assert.strictEqual(logic.joinVerdict(cfg, { createdAt: 0, hasAvatar: false }, now), 'noAvatar');
  assert.strictEqual(logic.joinVerdict(cfg, { createdAt: 0, hasAvatar: true }, now), null);
  assert.strictEqual(logic.joinVerdict({ ...cfg, minAccountAgeMs: 0, noAvatar: false }, { createdAt: now, hasAvatar: false }, now), null);
  assert.strictEqual(logic.isRaid(4, cfg), false);
  assert.strictEqual(logic.isRaid(5, cfg), true);
});

test('lock overwrite keeps unrelated bits and denies talking', () => {
  const prev = { allow: (PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles).toString(), deny: PermissionFlagsBits.MentionEveryone.toString() };
  const next = logic.lockedOverwrite(prev);
  assert.strictEqual(next.allow, PermissionFlagsBits.AttachFiles);
  assert.ok(next.deny & PermissionFlagsBits.SendMessages);
  assert.ok(next.deny & PermissionFlagsBits.MentionEveryone);
  assert.ok(next.deny & PermissionFlagsBits.Connect);
  const fromNone = logic.lockedOverwrite(null);
  assert.strictEqual(fromNone.allow, 0n);
  const opts = logic.overwriteOptions(PermissionFlagsBits.AttachFiles, PermissionFlagsBits.SendMessages);
  assert.deepStrictEqual(opts, { AttachFiles: true, SendMessages: false });
});

test('strip keeps managed roles and roles above the bot', () => {
  const roles = [{ id: 'g', managed: false, position: 0 }, { id: 'a', managed: false, position: 2 }, { id: 'b', managed: true, position: 3 }, { id: 'c', managed: false, position: 9 }];
  assert.deepStrictEqual(rolesToKeep(roles, 5, 'g'), ['b', 'c']);
});

function fakeGuild() {
  const everyoneId = '100000000000000001';
  const calls = [];
  const makeChannel = (id, type, overwrite, visible = true) => {
    const cache = new Map();
    if (overwrite) cache.set(everyoneId, { allow: { bitfield: BigInt(overwrite.allow) }, deny: { bitfield: BigInt(overwrite.deny) } });
    return {
      id, type,
      permissionsFor: (target) => ({ has: (p) => (target === 'me' ? true : (p === PermissionFlagsBits.ViewChannel ? visible : true)) }),
      permissionOverwrites: {
        cache,
        create: async (tid, opts) => { calls.push(['create', id, opts]); },
        delete: async (tid) => { calls.push(['delete', id]); }
      }
    };
  };
  const channels = [
    makeChannel('200000000000000001', ChannelType.GuildText, null),
    makeChannel('200000000000000002', ChannelType.GuildText, { allow: PermissionFlagsBits.AttachFiles, deny: 0n }),
    makeChannel('200000000000000003', ChannelType.GuildText, null, false),
    makeChannel('200000000000000004', ChannelType.GuildCategory, null)
  ];
  return {
    calls,
    guild: {
      id: '300000000000000001',
      roles: { everyone: { id: everyoneId } },
      members: { me: 'me' },
      channels: { cache: new Map(channels.map((c) => [c.id, c])) }
    }
  };
}

test('lockdown saves overwrites, locks public channels only, then restores exactly', async () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'lock-')) });
  const { guild, calls } = fakeGuild();
  const res = await lockdown.startLockdown(guild, store, { by: '1', reason: 'r' });
  assert.deepStrictEqual(res, { locked: 2, failed: 0 });
  assert.strictEqual((await lockdown.startLockdown(guild, store, { by: '1' })).already, true);
  const state = lockdown.getLockdown(store, guild.id);
  assert.deepStrictEqual(Object.keys(state.channels).sort(), ['200000000000000001', '200000000000000002']);
  assert.strictEqual(state.channels['200000000000000001'], null);
  assert.strictEqual(calls[0][2].SendMessages, false);
  calls.length = 0;
  const end = await lockdown.endLockdown(guild, store, 'end');
  assert.deepStrictEqual(end, { restored: 2, failed: 0, missing: 0 });
  assert.deepStrictEqual(calls.find((c) => c[1] === '200000000000000001'), ['delete', '200000000000000001']);
  assert.deepStrictEqual(calls.find((c) => c[1] === '200000000000000002')[2], { AttachFiles: true });
  assert.strictEqual(lockdown.getLockdown(store, guild.id), null);
  assert.strictEqual((await lockdown.endLockdown(guild, store)).notActive, true);
});

test('module shape and commands build with localizations', () => {
  assert.strictEqual(mod.name, 'antiraid');
  assert.strictEqual(mod.commands.length, 3);
  for (const cmd of mod.commands) {
    cmd.module = 'antiraid';
    const json = buildCommandJSON(cmd);
    assert.match(json.name, /^[a-z_-]{1,32}$/);
    assert.ok(json.description_localizations.ar, `${json.name} has a French description`);
    const walk = (opts) => {
      for (const o of opts || []) {
        assert.ok(o.description.length >= 1 && o.description.length <= 100, `${o.name} description length`);
        for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, `${o.name}: "${v}" too long`);
        for (const c of o.choices || []) assert.ok(c.name_localizations?.ar, `choice ${c.value} localized`);
        walk(o.options);
      }
    };
    walk(json.options);
  }
});

test('locale key parity across languages', () => {
  const base = flatten(locale('ar')).sort();
  for (const lang of LANGS) assert.deepStrictEqual(flatten(locale(lang)).sort(), base, `${lang} keys match fr`);
});

test('every literal translation key used in the code exists', () => {
  const keys = new Set(flatten(locale('ar')));
  const dir = path.join(ROOT, 'src/modules/antiraid');
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); };
  walk(dir);
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // 'antiraid:end' is the scheduler job type, not a translation key.
    for (const m of src.matchAll(/(?:`\$\{NS\}:|'antiraid:|\bt\(')([\w.]+)[`']/g)) if (m[0] !== "'antiraid:end'") assert.ok(keys.has(m[1]), `${path.basename(file)} uses missing key ${m[1]}`);
  }
});

test('dashboard schema matches the paths and defaults the code reads', () => {
  const fake = fakeStore();
  logic.readConfig(fake);
  const read = new Set(fake.reads);
  const keys = new Set(flatten(locale('ar')).map((k) => `antiraid:${k}`));
  const types = new Set(['boolean', 'number', 'string', 'text', 'channel', 'role', 'channels', 'roles', 'select', 'list', 'duration']);
  for (const section of mod.dashboard.sections) {
    assert.ok(keys.has(section.title));
    for (const f of section.fields) {
      assert.ok(read.has(f.path), `${f.path} is read by readConfig`);
      const def = Object.values(logic.SETTINGS).find((s) => s.path === f.path);
      assert.deepStrictEqual(f.default, def.default);
      assert.ok(types.has(f.type));
      assert.ok(keys.has(f.label) && keys.has(f.help), `labels of ${f.path}`);
      for (const o of f.options || []) assert.ok(keys.has(o.label));
    }
  }
  const paths = mod.dashboard.sections.flatMap((s) => s.fields.map((f) => f.path));
  assert.deepStrictEqual([...paths].sort(), Object.values(logic.SETTINGS).map((s) => s.path).sort(), 'every setting is on the dashboard');
  for (const a of mod.dashboard.actions) assert.ok(keys.has(a.label) && typeof a.run === 'function');
});
