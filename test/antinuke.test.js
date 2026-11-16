'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'antinuke-'));

const { AuditLogEvent, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const logic = require('../src/modules/antinuke/logic');
const memory = require('../src/modules/antinuke/memory');
const { handle } = require('../src/modules/antinuke/guard');
const mod = require('../src/modules/antinuke');
const { buildCommandJSON } = require('../src/core/registry');
const { createStore } = require('../src/core/store');
const i18n = require('../src/core/i18n');
const embeds = require('../src/core/embeds');

const ROOT = path.join(__dirname, '..');
const LANGS = ['ar', 'en'];
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', lang, 'antinuke.json'), 'utf8'));
const flatten = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${p}${k}.`) : [`${p}${k}`]));
const fakeStore = (data = {}) => {
  const reads = [];
  return { reads, get: (p, d) => { reads.push(p); return p in data ? data[p] : d; } };
};
const bits = (b) => ({ bitfield: BigInt(b) });

test('readConfig builds limits with defaults and clamps values', () => {
  const cfg = logic.readConfig(fakeStore({ 'antinuke.limits.ban.limit': 500, 'antinuke.limits.kick.windowSec': 'x', 'antinuke.punishment': 'nope', 'antinuke.quarantineRoleId': 'bad' }));
  assert.strictEqual(cfg.limits.ban.limit, 100);
  assert.strictEqual(cfg.limits.kick.windowSec, logic.ACTION_DEFS.kick.windowSec);
  assert.strictEqual(cfg.punishment, 'strip');
  assert.strictEqual(cfg.quarantineRoleId, null);
  assert.deepStrictEqual(Object.keys(cfg.limits).sort(), [...logic.ACTIONS].sort());
});

test('limits, triggering and panic mode', () => {
  const cfg = logic.readConfig(fakeStore());
  assert.deepStrictEqual(logic.effectiveLimit(cfg, 'ban', false), { limit: 3, windowSec: 60 });
  assert.strictEqual(logic.effectiveLimit(cfg, 'ban', true).limit, 0);
  assert.strictEqual(logic.effectiveLimit(cfg, 'webhookSpam', true).limit, cfg.limits.webhookSpam.limit);
  assert.strictEqual(logic.isTriggered(3, 3), false);
  assert.strictEqual(logic.isTriggered(4, 3), true);
  assert.strictEqual(logic.isTriggered(1, 0), true);
});

test('dangerous permission maths', () => {
  const prev = P.SendMessages;
  const next = P.SendMessages | P.Administrator | P.AttachFiles;
  assert.strictEqual(logic.dangerousAdded(prev, next), P.Administrator);
  assert.strictEqual(logic.revertedPermissions(prev, next), P.SendMessages | P.AttachFiles);
  assert.strictEqual(logic.dangerousAdded(next, prev), 0n);
  assert.ok(logic.hasDangerous(P.BanMembers));
  assert.ok(!logic.hasDangerous(P.SendMessages | P.ViewChannel));
});

test('audit entries are classified', () => {
  const c = (action, changes) => logic.classify({ action, changes });
  assert.strictEqual(c(AuditLogEvent.ChannelDelete), 'channelDelete');
  assert.strictEqual(c(AuditLogEvent.MemberBanAdd), 'ban');
  assert.strictEqual(c(AuditLogEvent.MemberPrune), 'prune');
  assert.strictEqual(c(AuditLogEvent.RoleUpdate, [{ key: 'permissions', old: '0', new: String(P.Administrator) }]), 'rolePermGrant');
  assert.strictEqual(c(AuditLogEvent.RoleUpdate, [{ key: 'permissions', old: '0', new: String(P.SendMessages) }]), null);
  assert.strictEqual(c(AuditLogEvent.RoleUpdate, [{ key: 'name', old: 'a', new: 'b' }]), null);
  assert.strictEqual(c(AuditLogEvent.MemberRoleUpdate, [{ key: '$add', new: [{ id: '1' }] }]), 'memberRoleGrant');
  assert.strictEqual(c(AuditLogEvent.MemberRoleUpdate, [{ key: '$remove', new: [{ id: '1' }] }]), null);
  assert.strictEqual(c(AuditLogEvent.GuildUpdate, [{ key: 'vanity_url_code', old: 'a', new: 'b' }]), 'vanity');
  assert.strictEqual(c(AuditLogEvent.GuildUpdate, [{ key: 'name', old: 'a', new: 'b' }]), 'guildUpdate');
  assert.strictEqual(c(AuditLogEvent.GuildUpdate, [{ key: 'premium_progress_bar_enabled', old: false, new: true }]), null);
  assert.strictEqual(c(AuditLogEvent.MessageDelete), null);
});

test('guild revert payload', () => {
  const { edit, vanity } = logic.guildRevert([
    { key: 'name', old: 'Old' }, { key: 'icon_hash', old: 'a_abc' }, { key: 'banner_hash', old: undefined },
    { key: 'verification_level', old: 2 }, { key: 'vanity_url_code', old: 'cool' }, { key: 'unknown', old: 1 }
  ], '42');
  assert.deepStrictEqual(edit, { name: 'Old', icon: 'https://cdn.discordapp.com/icons/42/a_abc.gif?size=1024', banner: null, verificationLevel: 2 });
  assert.strictEqual(vanity, 'cool');
});

const fakeChannel = (over = {}) => ({
  id: '11', name: 'general', type: ChannelType.GuildVoice, parentId: '10', rawPosition: 4, bitrate: 384000, userLimit: 5,
  permissionOverwrites: { cache: new Map([['r1', { id: 'r1', type: 0, allow: bits(P.ViewChannel), deny: bits(0) }], ['gone', { id: 'gone', type: 1, allow: bits(0), deny: bits(P.Connect) }]]) },
  ...over
});

test('channel snapshot and create options', () => {
  const snap = logic.channelSnapshot(fakeChannel());
  assert.strictEqual(JSON.parse(JSON.stringify(snap)).overwrites.length, 2, 'snapshot is JSON safe');
  const opts = logic.channelCreateOptions(snap, { exists: (id) => id === 'r1', parentExists: () => true, maxBitrate: 96000 });
  assert.strictEqual(opts.parent, '10');
  assert.strictEqual(opts.position, 4);
  assert.strictEqual(opts.bitrate, 96000);
  assert.strictEqual(opts.userLimit, 5);
  assert.deepStrictEqual(opts.permissionOverwrites, [{ id: 'r1', type: 0, allow: P.ViewChannel, deny: 0n }]);
  assert.ok(!('topic' in opts));
  const noParent = logic.channelCreateOptions(snap, { exists: () => true, parentExists: () => false });
  assert.ok(!('parent' in noParent));
  const cat = logic.channelCreateOptions(logic.channelSnapshot(fakeChannel({ type: ChannelType.GuildCategory })), { exists: () => true, parentExists: () => true });
  assert.ok(!('parent' in cat), 'a category has no parent');
  const fallback = logic.channelSnapshotFromChanges('9', [{ key: 'name', old: 'logs' }, { key: 'permission_overwrites', old: [{ id: 'r', type: 0, allow: '1', deny: '0' }] }]);
  assert.strictEqual(fallback.name, 'logs');
  assert.strictEqual(fallback.overwrites[0].allow, '1');
});

test('role snapshot keeps members and overwrites, create options stay below the bot', () => {
  const role = { id: 'r1', name: 'Mods', color: 5, hoist: true, mentionable: false, permissions: bits(P.BanMembers), position: 12, unicodeEmoji: null };
  const members = [{ id: 'u1', _roles: ['r1'] }, { id: 'u2', _roles: [] }];
  const channels = [fakeChannel(), { id: 'c2', permissionOverwrites: { cache: new Map() } }];
  const snap = logic.roleSnapshot(role, members, channels);
  assert.deepStrictEqual(snap.members, ['u1']);
  assert.deepStrictEqual(snap.overwrites, [{ channelId: '11', allow: String(P.ViewChannel), deny: '0' }]);
  const opts = logic.roleCreateOptions(snap, 8);
  assert.strictEqual(opts.position, 7);
  assert.strictEqual(opts.permissions, P.BanMembers);
});

test('strip plan', () => {
  const roles = [{ id: 'g', managed: false, position: 0 }, { id: 'a', managed: false, position: 2 }, { id: 'boost', managed: true, position: 1 }, { id: 'high', managed: false, position: 20 }];
  assert.deepStrictEqual(logic.stripPlan(roles, 10, 'g', 'q'), { keep: ['boost', 'high', 'q'], removed: ['a'] });
  assert.deepStrictEqual(logic.stripPlan(roles, 10, 'g', null).keep, ['boost', 'high']);
});

test('ttl map, window and waitFor', async () => {
  let now = 0;
  const m = memory.createTtlMap(1000, { now: () => now, max: 2 });
  m.set('g:a:1', 1); m.set('g:a:2', 2);
  assert.deepStrictEqual(m.valuesWithPrefix('g:a:'), [1, 2]);
  m.set('x', 3);
  assert.strictEqual(m.get('g:a:1'), undefined, 'oldest evicted');
  now = 2000;
  assert.strictEqual(m.get('x'), undefined, 'expired');
  const w = memory.createWindow({ now: () => now });
  w.hit('k', 100, 1); now += 50; assert.strictEqual(w.hit('k', 100, 2).length, 2); now += 60; assert.deepStrictEqual(w.hit('k', 100, 3), [2, 3]);
  let v;
  setTimeout(() => { v = 'ready'; }, 50);
  assert.strictEqual(await memory.waitFor(() => v, 1000, 10), 'ready');
  assert.strictEqual(await memory.waitFor(() => undefined, 30, 10), undefined);
});

function fakeCtx(store, whitelisted = []) {
  const logs = [];
  return {
    logs,
    client: { user: { id: '999999999999999999' } },
    store,
    t: i18n.t,
    embeds,
    logger: { debug() {}, warn() {}, info() {}, error() {} },
    permissions: { isWhitelisted: (g, id) => whitelisted.includes(id) },
    scheduler: { schedule: () => 'job', cancel: () => true },
    modlog: { send: async (g, cat, embed) => { logs.push({ cat, embed }); return null; } }
  };
}
const fakeGuild = (id) => ({ id, roles: { cache: new Map() }, members: { fetch: async () => { throw new Error('unknown'); }, cache: new Map() }, channels: { cache: new Map() } });

test('guard ignores trusted users and triggers past the limit', async () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')) });
  const guild = fakeGuild('500000000000000001');
  const gs = store.guild(guild.id);
  const ctx = fakeCtx(store, ['111']);
  assert.strictEqual(await handle(ctx, guild, '222', { action: 'kick', targetId: 'x' }), 'ignored', 'disabled by default');
  gs.set('antinuke.enabled', true);
  gs.set('antinuke.autoPanic', false);
  assert.strictEqual(await handle(ctx, guild, '111', { action: 'kick', targetId: 'x' }), 'ignored', 'whitelisted');
  assert.strictEqual(await handle(ctx, guild, ctx.client.user.id, { action: 'kick', targetId: 'x' }), 'ignored', 'the bot itself');
  for (let i = 0; i < 3; i++) assert.strictEqual(await handle(ctx, guild, '222', { action: 'kick', targetId: `t${i}` }), 'counted');
  assert.strictEqual(await handle(ctx, guild, '222', { action: 'kick', targetId: 't3' }), 'triggered');
  assert.strictEqual(ctx.logs.length, 1);
  assert.strictEqual(ctx.logs[0].cat, 'antinuke');
  assert.strictEqual(await handle(ctx, guild, '222', { action: 'ban', targetId: 't4' }), 'followup', 'flagged executor');
});

test('panic mode makes the first action fatal', async () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'panic-')) });
  const guild = fakeGuild('500000000000000002');
  store.guild(guild.id).set('antinuke.panic', { active: true, until: Date.now() + 60000, roles: {} });
  const ctx = fakeCtx(store);
  assert.strictEqual(await handle(ctx, guild, '333', { action: 'channelCreate', targetId: 'c' }), 'triggered');
});

test('module shape and commands build with localizations', () => {
  assert.strictEqual(mod.name, 'antinuke');
  assert.deepStrictEqual(mod.commands.map((c) => c.data.name).sort(), ['antinuke', 'panic', 'whitelist']);
  for (const cmd of mod.commands) {
    cmd.module = 'antinuke';
    const json = buildCommandJSON(cmd);
    assert.ok(json.description_localizations.ar, `${json.name} has a French description`);
    const walk = (opts) => {
      for (const o of opts || []) {
        assert.ok(o.description.length >= 1 && o.description.length <= 100, `${o.name} description length`);
        for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, `${o.name}: "${v}" too long`);
        for (const ch of o.choices || []) {
          assert.ok(ch.name_localizations?.ar, `choice ${ch.value} localized`);
          for (const v of Object.values(ch.name_localizations)) assert.ok(v.length <= 100);
        }
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
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : files.push(path.join(d, f.name)); };
  walk(path.join(ROOT, 'src/modules/antinuke'));
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    // 'antinuke:panicEnd' is the scheduler job type, not a translation key.
    for (const m of src.matchAll(/(?:`\$\{NS\}:|'antinuke:|\bt\(')([\w.]+)[`']/g)) if (m[0] !== "'antinuke:panicEnd'") assert.ok(keys.has(m[1]), `${path.basename(file)} uses missing key ${m[1]}`);
  }
  for (const a of logic.ACTIONS) assert.ok(keys.has(`actions.${a}`) && keys.has(`dashboard.limitFields.${a}.limit`));
  for (const p of logic.PUNISHMENTS) assert.ok(keys.has(`punishments.${p}`));
});

test('dashboard schema matches the paths and defaults the code reads', () => {
  const fake = fakeStore();
  logic.readConfig(fake);
  const read = new Set([...fake.reads, 'whitelist']); // "whitelist" is read by core permissions.isWhitelisted and /whitelist.
  assert.ok(fs.readFileSync(path.join(ROOT, 'src/core/permissions.js'), 'utf8').includes("get('whitelist', [])"));
  const keys = new Set(flatten(locale('ar')).map((k) => `antinuke:${k}`));
  for (const section of mod.dashboard.sections) {
    assert.ok(keys.has(section.title) && keys.has(section.description));
    for (const f of section.fields) {
      assert.ok(read.has(f.path), `${f.path} is read by the code`);
      const def = Object.values(logic.SETTINGS).find((s) => s.path === f.path);
      assert.deepStrictEqual(f.default, def ? def.default : []);
      assert.ok(keys.has(f.label) && keys.has(f.help), `labels of ${f.path}`);
      for (const o of f.options || []) assert.ok(keys.has(o.label));
    }
  }
  const paths = mod.dashboard.sections.flatMap((s) => s.fields.map((f) => f.path)).filter((p) => p !== 'whitelist');
  assert.deepStrictEqual(paths.sort(), Object.values(logic.SETTINGS).map((s) => s.path).sort());
  for (const a of mod.dashboard.actions) assert.ok(keys.has(a.label) && typeof a.run === 'function');
});
