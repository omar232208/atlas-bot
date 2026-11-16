'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../src/core/store');
const i18n = require('../src/core/i18n');
const embeds = require('../src/core/embeds');
const { buildCommandJSON } = require('../src/core/registry');
const giveaways = require('../src/modules/giveaways/index.js');
const logic = require('../src/modules/giveaways/lib/logic');
const { endGiveaway, rerollGiveaway, cancelGiveaway, save, load } = require('../src/modules/giveaways/lib/finish');
const { enterComponent } = require('../src/modules/giveaways/components/enter');

const MODULE_DIR = path.join(__dirname, '..', 'src', 'modules', 'giveaways');
const LOCALES = path.join(__dirname, '..', 'locales');
const LANGS = ['ar', 'en'];

const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
const tempStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-gw-')), debounceMs: 0 });
const DAY = 24 * 60 * 60 * 1000;

/** Context with real i18n and embeds, a fake scheduler and a silent logger. */
function makeCtx(store) {
  const jobs = [];
  return {
    store,
    t: i18n.t,
    embeds,
    logger: { warn() {}, error() {}, info() {} },
    scheduler: { schedule: (...a) => { jobs.push(a); return `job-${jobs.length}`; }, cancel: () => true },
    jobs
  };
}

/** Fake Discord client: channels and messages accept every edit and send. */
function fakeClient() {
  const sent = [];
  const message = { edit: async (body) => { sent.push({ kind: 'edit', body }); return message; } };
  const channel = {
    messages: { fetch: async () => message },
    send: async (body) => { sent.push({ kind: 'send', body }); return message; }
  };
  return {
    sent,
    channels: { fetch: async () => channel },
    users: { fetch: async (id) => ({ send: async (body) => sent.push({ kind: 'dm', id, body }) }) }
  };
}

const record = (over = {}) => ({
  id: 'abcd1234', guildId: '900', channelId: '10', messageId: '20', prize: 'Nitro', winnersCount: 1,
  hostId: '1', createdAt: 0, endsAt: Date.now() + DAY, requiredRoleId: null, minAccountDays: 0,
  entries: { 'u1': true, 'u2': true, 'u3': true }, status: 'active', winnerIds: [], jobId: 'job-x', ...over
});

// ---------- logic ----------

test('pickWinners draws distinct entrants and respects the count and exclusions', () => {
  const entries = ['a', 'b', 'c', 'd'];
  const winners = logic.pickWinners(entries, 3, Math.random);
  assert.equal(winners.length, 3);
  assert.equal(new Set(winners).size, 3);
  assert.ok(winners.every((w) => entries.includes(w)));
  assert.deepEqual(logic.pickWinners(entries, 10, Math.random).sort(), [...entries].sort(), 'asks for more than exist');
  assert.deepEqual(logic.pickWinners(['a', 'b'], 2, Math.random, ['a']), ['b'], 'excluded ids never win');
  assert.deepEqual(logic.pickWinners([], 1, Math.random), []);
  assert.deepEqual(logic.pickWinners(['a', 'b', 'c'], 1, seq([0])), ['a']);
  assert.deepEqual(logic.pickWinners(['a', 'b', 'c'], 1, seq([0.99])), ['c']);
});

test('ineligibility checks the role first, then the account age', () => {
  const now = 100 * DAY;
  const base = { roleIds: ['r1'], accountCreatedAt: now - 10 * DAY, now, requiredRoleId: null, minAccountDays: 0 };
  assert.equal(logic.ineligibility(base), null);
  assert.equal(logic.ineligibility({ ...base, requiredRoleId: 'r2' }), 'role');
  assert.equal(logic.ineligibility({ ...base, requiredRoleId: 'r1' }), null);
  assert.equal(logic.ineligibility({ ...base, minAccountDays: 30 }), 'age');
  assert.equal(logic.ineligibility({ ...base, minAccountDays: 10 }), null);
  assert.equal(logic.ineligibility({ ...base, requiredRoleId: 'r2', minAccountDays: 30 }), 'role');
});

test('newId is 8 hex characters and unique enough across calls', () => {
  const ids = new Set(Array.from({ length: 200 }, () => logic.newId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}$/);
});

test('getConfig merges stored values over defaults', () => {
  const s = tempStore();
  assert.deepEqual(logic.getConfig(s, '901'), logic.DEFAULTS);
  s.guild('901').set('giveaways.config', { maxDays: 7 });
  assert.deepEqual(logic.getConfig(s, '901'), { ...logic.DEFAULTS, maxDays: 7 });
});

// ---------- lifecycle with a fake client ----------

test('endGiveaway draws winners from the entries, saves them and announces', async () => {
  const s = tempStore();
  const ctx = makeCtx(s);
  const client = fakeClient();
  save(ctx, '900', record());
  const settled = await endGiveaway(ctx, client, '900', 'abcd1234');
  assert.equal(settled.status, 'ended');
  assert.equal(settled.winnerIds.length, 1);
  assert.ok(['u1', 'u2', 'u3'].includes(settled.winnerIds[0]));
  assert.equal(load(ctx, '900', 'abcd1234').status, 'ended');
  assert.ok(client.sent.some((m) => m.kind === 'send' && m.body.content === `<@${settled.winnerIds[0]}>`));
  assert.ok(client.sent.some((m) => m.kind === 'dm' && m.id === settled.winnerIds[0]), 'winner gets a DM by default');
  assert.equal(await endGiveaway(ctx, client, '900', 'abcd1234'), null, 'an ended giveaway cannot end twice');
});

test('endGiveaway without entries ends with nobody and no DM', async () => {
  const s = tempStore();
  const ctx = makeCtx(s);
  const client = fakeClient();
  save(ctx, '900', record({ id: 'empty001', entries: {} }));
  const settled = await endGiveaway(ctx, client, '900', 'empty001');
  assert.deepEqual(settled.winnerIds, []);
  assert.equal(client.sent.some((m) => m.kind === 'dm'), false);
});

test('dmWinners=false stops the private messages', async () => {
  const s = tempStore();
  s.guild('902').set('giveaways.config', { dmWinners: false });
  const ctx = makeCtx(s);
  const client = fakeClient();
  save(ctx, '902', record({ guildId: '902', id: 'nodm0001' }));
  await endGiveaway(ctx, client, '902', 'nodm0001');
  assert.equal(client.sent.some((m) => m.kind === 'dm'), false);
});

test('reroll never repeats the previous winners and refuses when nobody else is left', async () => {
  const s = tempStore();
  const ctx = makeCtx(s);
  const client = fakeClient();
  save(ctx, '900', record({ id: 'rerl0001', status: 'ended', winnerIds: ['u1'] }));
  const rerolled = await rerollGiveaway(ctx, client, '900', 'rerl0001');
  assert.notEqual(rerolled.winnerIds[0], 'u1');
  save(ctx, '900', record({ id: 'rerl0002', status: 'ended', entries: { u1: true }, winnerIds: ['u1'] }));
  assert.deepEqual(await rerollGiveaway(ctx, client, '900', 'rerl0002'), { noAlternative: true });
  assert.equal(await rerollGiveaway(ctx, client, '900', 'nope0000'), null);
});

test('cancelGiveaway cancels the end job and leaves no winners', async () => {
  const s = tempStore();
  const ctx = makeCtx(s);
  save(ctx, '900', record({ id: 'canc0001' }));
  const settled = await cancelGiveaway(ctx, fakeClient(), '900', 'canc0001');
  assert.equal(settled.status, 'cancelled');
  assert.deepEqual(settled.winnerIds, []);
  assert.equal(await cancelGiveaway(ctx, fakeClient(), '900', 'canc0001'), null);
});

test('the enter button refuses a giveaway that is not active', async () => {
  const s = tempStore();
  const ctx = makeCtx(s);
  save(ctx, '900', record({ id: 'done0001', status: 'ended' }));
  const replies = [];
  const interaction = {
    customId: 'gw:enter:done0001', guildId: '900', user: { id: 'u9', createdTimestamp: 0 }, member: { roles: [] },
    reply: async (body) => replies.push(body), locale: 'ar', guild: null
  };
  await enterComponent.execute(interaction, ctx);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, 64);
  assert.equal(load(ctx, '900', 'done0001').entries.u9, undefined);
});

// ---------- command data, dashboard, locales ----------

test('dashboard: each field path is read by the code (a stored value changes the config)', () => {
  const schema = giveaways.dashboard.sections[0];
  const s = tempStore();
  for (const field of schema.fields) {
    const key = field.path.replace(/^giveaways\.config\./, '');
    assert.match(field.path, /^giveaways\.config\.\w+$/);
    assert.deepEqual(field.default, logic.DEFAULTS[key], `default of ${field.path}`);
    const value = field.type === 'boolean' ? !field.default : field.min + 1;
    s.guild('903').set(field.path, value);
    assert.equal(logic.getConfig(s, '903')[key], value, `code does not read ${field.path}`);
  }
});

test('every command builds valid, localized Discord JSON', () => {
  for (const cmd of giveaways.commands) {
    cmd.module = 'giveaways';
    const json = buildCommandJSON(cmd);
    assert.match(json.name, /^[-_a-z0-9]{1,32}$/);
    assert.ok(json.description_localizations?.ar, `${json.name} has no French description`);
    const start = json.options.find((o) => o.name === 'start');
    assert.ok(start && start.options.length >= 6, 'start has its options');
    assert.ok(start.options.find((o) => o.name === 'prize').description_localizations?.ar);
  }
});

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

test('locale files: the five languages have identical key sets', () => {
  const sets = LANGS.map((lang) => new Set(flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, lang, 'giveaways.json'), 'utf8')))));
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
    for (const [, key] of fs.readFileSync(file, 'utf8').matchAll(/'(giveaways:[A-Za-z0-9_.-]+)'/g)) keys.add(key);
  }
  // giveaways:end is the scheduler job type, not a translation key.
  keys.delete('giveaways:end');
  assert.ok(keys.size > 40);
  for (const key of keys) for (const lang of LANGS) assert.ok(i18n.has(lang, key), `${lang} is missing ${key}`);
});

test('no single-quoted literal uses the giveaways. prefix except the store paths', () => {
  // A translation written as 'giveaways.x.y' (no colon) would render as the raw key.
  const allowed = new Set(['giveaways.config', 'giveaways.items']);
  for (const file of sourceFiles(MODULE_DIR)) {
    for (const [, lit] of fs.readFileSync(file, 'utf8').matchAll(/'(giveaways\.[A-Za-z0-9_.]+)'/g)) {
      if (/^giveaways\.config\.\w+$/.test(lit)) continue;
      assert.ok(allowed.has(lit), `${path.basename(file)}: "${lit}" is a translation key missing its colon`);
    }
  }
});
