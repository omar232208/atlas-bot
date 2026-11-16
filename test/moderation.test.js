'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-moderation-'));

const { createStore } = require('../src/core/store');
const { createScheduler } = require('../src/core/scheduler');
const i18n = require('../src/core/i18n');
const embeds = require('../src/core/embeds');
const registry = require('../src/core/registry');
const mod = require('../src/modules/moderation');
const cases = require('../src/modules/moderation/lib/cases');
const config = require('../src/modules/moderation/lib/config');
const thresholds = require('../src/modules/moderation/lib/thresholds');
const { matchesPurge, parseIds } = require('../src/modules/moderation/lib/purge');
const { snapshot, lockPerms } = require('../src/modules/moderation/lib/locks');
const actions = require('../src/modules/moderation/lib/actions');

const tmpStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-mod-store-')), debounceMs: 5 });
let nextGuild = 1000;

/** Minimal ctx + fake guild/user objects recording what the bot did. */
function setup() {
  const store = tmpStore();
  const scheduler = createScheduler({ store });
  const calls = [];
  const logs = [];
  const guildId = String(nextGuild++);
  const botUser = { id: '999', tag: 'Bot#0001', username: 'Bot' };
  const ctx = {
    store, scheduler, embeds, t: i18n.t,
    client: { user: botUser, guilds: { cache: new Map() }, users: { fetch: async (id) => ({ id, tag: `u${id}` }) } },
    modlog: { send: async (g, cat, embed) => { logs.push({ cat, embed }); return null; } },
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    permissions: { canModerate: () => true, botCan: () => true }
  };
  const member = (id) => ({ id, timeout: async (ms) => calls.push(['timeout', id, ms]), kick: async () => calls.push(['kick', id]) });
  const guild = {
    id: guildId, name: 'Test', members: { me: { id: botUser.id }, fetch: async (id) => member(id), cache: new Map() },
    bans: { create: async (id, o) => calls.push(['ban', id, o.deleteMessageSeconds]), remove: async (id) => calls.push(['unban', id]) }
  };
  ctx.client.guilds.cache.set(guildId, guild);
  const user = (id, dmOk = true) => ({ id, tag: `user${id}`, bot: false, send: async () => { if (!dmOk) throw new Error('closed'); calls.push(['dm', id]); return { delete: async () => calls.push(['dmDeleted', id]) }; } });
  return { ctx, guild, calls, logs, member, user, gs: store.guild(guildId), botUser };
}

test('moderation: exports at most 10 top-level commands, all valid and localized', () => {
  assert.equal(mod.name, 'moderation');
  assert.ok(mod.commands.length <= 10, `${mod.commands.length} top-level commands`);
  const names = mod.commands.map((c) => c.data.name).sort();
  assert.deepEqual(names, ['ban', 'case', 'kick', 'lock', 'mod', 'purge', 'slowmode', 'timeout', 'unban', 'warn']);
  for (const cmd of mod.commands) {
    const json = registry.buildCommandJSON({ ...cmd, module: 'moderation' });
    assert.match(json.name, /^[a-z_-]{1,32}$/);
    const walk = (node, where) => {
      for (const lang of ['ar', 'en-US', 'en-GB']) {
        const text = node.description_localizations?.[lang];
        assert.ok(text, `missing ${lang} description for ${where}`);
        assert.ok(text.length <= 100, `${where} (${lang}) is longer than 100 characters`);
      }
      for (const opt of node.options || []) walk(opt, `${where} ${opt.name}`);
    };
    walk(json, `/${json.name}`);
  }
  const modCmd = mod.commands.find((c) => c.data.name === 'mod').data.toJSON();
  const subs = modCmd.options.map((o) => o.name).sort();
  assert.deepEqual(subs, ['clearwarns', 'config', 'history', 'massban', 'nick', 'softban', 'unlock', 'untimeout', 'unwarn', 'warnconfig', 'warnings']);
});

test('moderation: locale key parity and placeholders across the 5 languages', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
  const load = (l) => new Map(flat(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', l, 'moderation.json'), 'utf8'))));
  const fr = load('ar');
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const lang of ['en']) {
    const other = load(lang);
    assert.deepEqual([...other.keys()].sort(), [...fr.keys()].sort(), `${lang} keys differ from ar`);
    for (const [k, v] of fr) assert.equal(vars(other.get(k)), vars(v), `${lang}:${k} placeholders`);
  }
});

test('moderation: every key used in the code exists in French', () => {
  const dir = path.join(__dirname, '..', 'src', 'modules', 'moderation');
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const [, key] of src.matchAll(/'(moderation:[a-zA-Z]+\.[a-zA-Z.]*[a-zA-Z])'/g)) assert.ok(i18n.has('ar', key), `${f}: ${key}`);
  }
  for (const type of cases.CASE_TYPES) assert.ok(i18n.has('ar', `moderation:types.${type}`));
  for (const type of actions.DM_TYPES) assert.ok(i18n.has('ar', `moderation:dm.title.${type}`));
});

test('moderation: dashboard schema paths are settings the code reads, with the same defaults', () => {
  const dir = path.join(__dirname, '..', 'src', 'modules', 'moderation');
  const code = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js') && !f.endsWith('config.js'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  for (const section of mod.dashboard.sections) {
    assert.ok(i18n.has('ar', section.title), section.title);
    for (const field of section.fields) {
      const name = Object.keys(config.SETTINGS).find((k) => config.SETTINGS[k].path === field.path);
      assert.ok(name, `${field.path} is not a known setting`);
      assert.deepEqual(field.default, config.SETTINGS[name].default);
      assert.ok(code.includes(`config.get(gs, '${name}')`), `${field.path} is never read`);
      assert.ok(i18n.has('ar', field.label) && i18n.has('ar', field.help), field.label);
    }
  }
});

test('cases: numbering, edit, delete, warns and expiry', () => {
  const gs = tmpStore().guild('1');
  const a = cases.createCase(gs, { type: 'warn', userId: '7', moderatorId: '1', reason: 'r1' }, 1000);
  const b = cases.createCase(gs, { type: 'warn', userId: '7', moderatorId: '1' }, 5000);
  const c = cases.createCase(gs, { type: 'kick', userId: '8', moderatorId: '1' });
  assert.deepEqual([a.id, b.id, c.id], [1, 2, 3]);
  assert.equal(a.active, true);
  assert.equal(cases.activeWarns(gs, '7', 0, 6000).length, 2);
  assert.equal(cases.activeWarns(gs, '7', 2000, 6000).length, 1, 'old warning expired');
  assert.equal(cases.updateCase(gs, 1, { reason: 'new' }).reason, 'new');
  assert.equal(cases.deleteCase(gs, 3).type, 'kick');
  assert.equal(cases.getCase(gs, 3), null);
  assert.equal(cases.createCase(gs, { type: 'ban', userId: '8', moderatorId: '1' }).id, 4, 'numbers are never reused');
  assert.equal(cases.clearWarns(gs, '7'), 2);
  assert.equal(cases.activeWarns(gs, '7').length, 0);
  assert.deepEqual(cases.listCases(gs, { userId: '7' }).map((x) => x.id), [2, 1]);
  assert.deepEqual(cases.countByType(cases.listCases(gs)), { warn: 2, ban: 1 });
  assert.throws(() => cases.createCase(gs, { type: 'nope', userId: '1', moderatorId: '1' }));
});

test('thresholds: normalize, upsert, remove, exact match', () => {
  const list = thresholds.upsertThreshold([], { warns: 3, action: 'timeout', duration: 3600000 });
  const two = thresholds.upsertThreshold(list, { warns: 5, action: 'kick', duration: 999 });
  assert.deepEqual(two, [{ warns: 3, action: 'timeout', duration: 3600000 }, { warns: 5, action: 'kick' }]);
  assert.equal(thresholds.matchThreshold(3, two).action, 'timeout');
  assert.equal(thresholds.matchThreshold(4, two), null, 'no re-trigger between thresholds');
  assert.deepEqual(thresholds.removeThreshold(two, 3), [{ warns: 5, action: 'kick' }]);
  assert.deepEqual(thresholds.normalizeThresholds([{ warns: 0, action: 'ban' }, { warns: 2, action: 'explode' }, null]), []);
});

test('purge: filters and id parsing', () => {
  const now = Date.now();
  const msg = (o) => ({ author: { id: '1', bot: false }, content: '', attachments: { size: 0 }, embeds: [], createdTimestamp: now, ...o });
  assert.ok(matchesPurge(msg({}), {}, now));
  assert.ok(!matchesPurge(msg({ pinned: true }), {}, now), 'pinned messages are kept');
  assert.ok(!matchesPurge(msg({ createdTimestamp: now - 15 * 86400000 }), {}, now), 'older than 14 days');
  assert.ok(matchesPurge(msg({ content: 'see https://x.com' }), { links: true }, now));
  assert.ok(!matchesPurge(msg({ content: 'no link' }), { links: true }, now));
  assert.ok(matchesPurge(msg({ author: { id: '2', bot: true } }), { bots: true }, now));
  assert.ok(!matchesPurge(msg({}), { bots: true }, now));
  assert.ok(!matchesPurge(msg({}), { userId: '3' }, now));
  assert.ok(matchesPurge(msg({ content: 'Hello World' }), { contains: 'world' }, now));
  assert.ok(matchesPurge(msg({ attachments: { size: 2 } }), { attachments: true }, now));
  assert.deepEqual(parseIds('<@123456789012345678> 123456789012345678, <@!223456789012345678> 12 abc'), ['123456789012345678', '223456789012345678']);
});

test('locks: snapshot keeps allowed, denied and inherited states', () => {
  const ow = { allow: { has: (p) => p === 'AddReactions' }, deny: { has: (p) => p === 'SendMessages' } };
  const snap = snapshot(ow, ['SendMessages', 'AddReactions', 'CreatePublicThreads']);
  assert.deepEqual(snap, { SendMessages: false, AddReactions: true, CreatePublicThreads: null });
  assert.ok(lockPerms({ isVoiceBased: () => true }).includes('Connect'));
  assert.ok(lockPerms({ isVoiceBased: () => false }).includes('SendMessagesInThreads'));
});

test('sanction: DM before the action, case, log, and warn threshold follow-up', async () => {
  const { ctx, guild, calls, logs, member, user, gs } = setup();
  config.set(gs, 'warnThresholds', [{ warns: 2, action: 'kick' }]);
  const target = user('42');
  const first = await actions.sanction(ctx, { guild, user: target, member: member('42'), moderator: { id: '1', tag: 'mod' }, type: 'warn', reason: 'spam' });
  assert.equal(first.case.id, 1);
  assert.equal(first.dmSent, true);
  assert.equal(first.followUp, null);
  const second = await actions.sanction(ctx, { guild, user: target, member: member('42'), moderator: { id: '1', tag: 'mod' }, type: 'warn' });
  assert.equal(second.followUp.type, 'kick');
  assert.equal(second.followUp.auto, true);
  assert.deepEqual(calls.map((c) => c[0]), ['dm', 'dm', 'dm', 'kick'], 'each DM is sent before its sanction');
  assert.equal(logs.length, 3);
  assert.ok(logs.every((l) => l.cat === 'moderation'));
});

test('sanction: temp ban schedules the unban, unban cancels it, failure withdraws the DM', async () => {
  const { ctx, guild, calls, user, gs } = setup();
  const mod1 = { id: '1', tag: 'mod' };
  const res = await actions.sanction(ctx, { guild, user: user('50'), moderator: mod1, type: 'ban', durationMs: 3600000, deleteSeconds: 3600 });
  assert.equal(res.case.type, 'tempban');
  assert.ok(res.case.expiresAt > Date.now());
  const jobs = ctx.scheduler.list(actions.JOB_UNBAN, (p) => p.userId === '50');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].payload.caseId, res.case.id);
  await actions.sanction(ctx, { guild, user: user('50'), moderator: mod1, type: 'unban' });
  assert.equal(ctx.scheduler.list(actions.JOB_UNBAN).length, 0);
  assert.deepEqual(calls.filter((c) => c[0] !== 'dm').map((c) => c[0]), ['ban', 'unban']);

  config.set(gs, 'dm', true);
  guild.bans.create = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); };
  await assert.rejects(actions.sanction(ctx, { guild, user: user('51'), moderator: mod1, type: 'ban' }), { code: 50013 });
  assert.ok(calls.some((c) => c[0] === 'dmDeleted' && c[1] === '51'));
  assert.equal(cases.listCases(gs, { userId: '51' }).length, 0, 'failed sanction leaves no case');
});

test('sanction: long timeouts are capped at 28 days and continued by the scheduler', async () => {
  const { ctx, guild, calls, member, user } = setup();
  const res = await actions.sanction(ctx, { guild, user: user('60', false), member: member('60'), moderator: { id: '1', tag: 'm' }, type: 'timeout', durationMs: 40 * 86400000 });
  assert.equal(res.dmSent, false, 'closed DMs do not block the sanction');
  const applied = calls.find((c) => c[0] === 'timeout')[2];
  assert.ok(applied <= thresholds.MAX_TIMEOUT_MS);
  const jobs = ctx.scheduler.list(actions.JOB_TIMEOUT);
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].payload.until - Date.now() > 39 * 86400000);
  await assert.rejects(actions.sanction(ctx, { guild, user: user('61'), member: null, moderator: { id: '1' }, type: 'kick' }), { code: 'NOT_MEMBER' });
});
