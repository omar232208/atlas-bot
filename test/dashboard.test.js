'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Isolated data folder: the store and i18n guild-language lookups must not touch data/.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-test-'));
delete process.env.DASHBOARD_URL;
delete process.env.DISCORD_CLIENT_SECRET;

const { ChannelType } = require('discord.js');
const store = require('../src/core/store');
const i18n = require('../src/core/i18n');
const { createAuth, safeEqual } = require('../src/modules/dashboard/lib/auth');
const { createRateLimiter } = require('../src/modules/dashboard/lib/ratelimit');
const schema = require('../src/modules/dashboard/lib/schema');
const { createDashboardServer } = require('../src/modules/dashboard/lib/server');
const dashboardModule = require('../src/modules/dashboard');

const GID = '800000000000000001';
const ADMIN = '600000000000000001';
const MEMBER = '600000000000000002';
const OWNER = '600000000000000099';
const TEXT = '900000000000000005';
const VOICE = '900000000000000007';
const ROLE = '700000000000000002';

const channels = new Map([
  [TEXT, { id: TEXT, name: 'general', type: ChannelType.GuildText, parentId: null, rawPosition: 1, isThread: () => false }],
  [VOICE, { id: VOICE, name: 'Vocal', type: ChannelType.GuildVoice, parentId: null, rawPosition: 2, isThread: () => false }]
]);
const roles = new Map([
  [GID, { id: GID, name: '@everyone', position: 0, hexColor: '#000000', managed: false }],
  [ROLE, { id: ROLE, name: 'Mod', position: 3, hexColor: '#2980b9', managed: false }]
]);
const guild = {
  id: GID, name: 'Test', ownerId: '600000000000000099', memberCount: 42, iconURL: () => null,
  channels: { cache: channels }, roles: { cache: roles },
  members: { fetch: async ({ user }) => ({ id: user, permissions: { has: () => user === ADMIN } }) }
};

const FIELDS = [
  { path: 'demo.enabled', type: 'boolean', label: 'demo:dashboard.f.enabled', default: false },
  { path: 'demo.count', type: 'number', label: 'demo:dashboard.f.count', default: 5, min: 1, max: 10 },
  { path: 'demo.name', type: 'string', label: 'demo:dashboard.f.name', default: '', maxLength: 10 },
  { path: 'demo.text', type: 'text', label: 'demo:dashboard.f.text', default: '' },
  { path: 'demo.channel', type: 'channel', label: 'demo:dashboard.f.channel', default: null, channelTypes: [ChannelType.GuildText] },
  { path: 'demo.role', type: 'role', label: 'demo:dashboard.f.role', default: null },
  { path: 'demo.channels', type: 'channels', label: 'demo:dashboard.f.channels', default: [], max: 2 },
  { path: 'demo.roles', type: 'roles', label: 'demo:dashboard.f.roles', default: [] },
  { path: 'demo.mode', type: 'select', label: 'demo:dashboard.f.mode', default: 'kick', options: [{ value: 'kick', label: 'x:a' }, { value: 'ban', label: 'x:b' }] },
  { path: 'demo.words', type: 'list', label: 'demo:dashboard.f.words', default: [], maxLength: 5, max: 3 },
  { path: 'demo.delay', type: 'duration', label: 'demo:dashboard.f.delay', default: 60000, min: 1000, max: 86400000 }
];
let actionRuns = 0;
let nukeRuns = 0;
const demoModule = {
  name: 'demo',
  dashboard: {
    sections: [
      { id: 'main', title: 'demo:dashboard.main.title', fields: [...FIELDS, { path: '__proto__.x', type: 'boolean' }, { path: 'demo.bad', type: 'nope' }] },
      { id: 'secure', ownerOnly: true, fields: [{ path: 'whitelist', type: 'list', label: 'demo:dashboard.f.whitelist', default: [] }] },
      { id: 'mixed', fields: [{ path: 'demo.secret', type: 'boolean', label: 'demo:dashboard.f.secret', default: false, ownerOnly: true }] }
    ],
    actions: [
      { id: 'reset', label: 'demo:dashboard.reset', danger: true, run: async () => { actionRuns += 1; return 'dashboard:api.actionDone'; } },
      { id: 'nuke', label: 'demo:dashboard.nuke', danger: true, ownerOnly: true, run: async () => { nukeRuns += 1; return 'dashboard:api.actionDone'; } }
    ]
  }
};

function makeCtx() {
  const users = new Map([[ADMIN, { id: ADMIN, username: 'admin', tag: 'admin' }]]);
  const sent = [];
  const ctx = {
    client: { guilds: { cache: new Map([[GID, guild]]) }, users: { cache: users, fetch: async (id) => users.get(id) || { id, username: id, tag: id } }, user: { id: '1' } },
    store, t: i18n.t, embeds: require('../src/core/embeds'), permissions: require('../src/core/permissions'),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    modlog: { send: async (g, category, embed) => { sent.push({ category, embed }); return null; } },
    modules: [demoModule]
  };
  return { ctx, sent };
}

test('session cookies are HMAC signed and tamper-proof', () => {
  const auth = createAuth({ store, secret: 's'.repeat(40) });
  const signed = auth.sign('abc');
  assert.equal(auth.verify(signed), 'abc');
  assert.equal(auth.verify(`${signed}x`), null);
  assert.equal(auth.verify('abd.' + signed.split('.')[1]), null);
  assert.equal(auth.verify(null), null);
  const { cookie, session } = auth.createSession(ADMIN, { guilds: [GID] });
  assert.equal(auth.getSession(cookie), session);
  assert.equal(auth.getSession(cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null);
  assert.ok(safeEqual('a', 'a') && !safeEqual('a', 'b') && !safeEqual('a', 'aa'));
});

test('sessions expire after 7 days and are persisted hashed', () => {
  let now = 1000;
  const auth = createAuth({ store, secret: 's'.repeat(40), now: () => now });
  const { cookie } = auth.createSession(ADMIN, { guilds: [GID] });
  const sid = auth.verify(cookie);
  assert.ok(!Object.keys(store.global().get('dashboard.sessions')).includes(sid), 'raw session id must not be stored');
  now += 7 * 24 * 3600 * 1000 + 1;
  assert.equal(auth.getSession(cookie), null);
});

test('magic links are single use, bound to user and guild, and expire after 10 minutes', () => {
  let now = 0;
  const auth = createAuth({ store, secret: 's'.repeat(40), now: () => now });
  const token = auth.issueLink(ADMIN, GID);
  assert.ok(token.length >= 40);
  assert.deepEqual(auth.consumeLink(token), { userId: ADMIN, guildId: GID });
  assert.equal(auth.consumeLink(token), null, 'second use must fail');
  const late = auth.issueLink(ADMIN, GID);
  now += 10 * 60 * 1000 + 1;
  assert.equal(auth.consumeLink(late), null, 'expired link must fail');
  assert.equal(auth.consumeLink('short'), null);
});

test('CSRF tokens and OAuth states are checked strictly', () => {
  const auth = createAuth({ store, secret: 's'.repeat(40) });
  const { session } = auth.createSession(ADMIN);
  assert.ok(auth.checkCsrf(session, session.csrf));
  assert.ok(!auth.checkCsrf(session, 'wrong'));
  assert.ok(!auth.checkCsrf(session, undefined));
  assert.ok(!auth.checkCsrf(null, session.csrf));
  const state = auth.issueState();
  assert.ok(auth.consumeState(state));
  assert.ok(!auth.consumeState(state));
});

test('rate limiter blocks after the limit and resets with the window', () => {
  let now = 0;
  const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.ok(rl.hit('a').ok && rl.hit('a').ok);
  assert.ok(!rl.hit('a').ok);
  assert.ok(rl.hit('b').ok);
  now = 1001;
  assert.ok(rl.hit('a').ok);
});

test('schema collection drops invalid fields and finds the module toggle', () => {
  const mods = schema.collect([demoModule, { name: 'empty' }]);
  assert.equal(mods.length, 1);
  assert.equal(mods[0].fields.size, FIELDS.length + 2);
  assert.equal(mods[0].toggle, 'demo.enabled');
  assert.ok(mods[0].fields.get('whitelist').ownerOnly, 'section flag applies to its fields');
  assert.ok(mods[0].fields.get('demo.secret').ownerOnly, 'field flag');
  assert.ok(!mods[0].fields.get('demo.count').ownerOnly);
  assert.ok(mods[0].actions.find((a) => a.id === 'nuke').ownerOnly);
  assert.ok(!mods[0].actions.find((a) => a.id === 'reset').ownerOnly);
  assert.equal(demoModule.dashboard.sections[2].fields[0].ownerOnly, true, 'module objects are not mutated');
  const admin = schema.publicSchema(mods[0], { isOwner: false });
  assert.equal(admin.sections[1].readOnly, true);
  assert.equal(admin.sections[0].readOnly, false);
  assert.equal(admin.sections[2].fields[0].readOnly, true);
  assert.equal(admin.actions[1].readOnly, true);
  const owner = schema.publicSchema(mods[0], { isOwner: true });
  assert.equal(owner.sections[1].readOnly, false);
  assert.equal(owner.actions[1].readOnly, false);
  const denied = schema.validatePatch(mods, { whitelist: ['1'] }, guild, { isOwner: false });
  assert.equal(denied.errors.whitelist.error, 'ownerOnly');
  assert.ok(schema.validatePatch(mods, { whitelist: ['1'] }, guild, { isOwner: true }).ok);
  const pub = schema.publicSchema(mods[0]);
  assert.equal(typeof pub.actions[0].run, 'undefined');
  assert.ok(JSON.stringify(pub));
  assert.ok(schema.labelKeys(mods).includes('demo:dashboard.f.count'));
  assert.ok(!schema.validPath('a..b') && !schema.validPath('constructor') && schema.validPath('a.b-c_d'));
});

test('built-in owner-only policy covers sensitive actions of other modules', () => {
  const run = async () => '';
  const mods = schema.collect([
    { name: 'antinuke', dashboard: { sections: [], actions: [{ id: 'panicOn', run }, { id: 'panicOff', run }] } },
    { name: 'backup', dashboard: { sections: [], actions: [{ id: 'createNow', run }] } },
    { name: 'core-commands', dashboard: { sections: [], actions: [{ id: 'reset', run }] } },
    { name: 'logs', dashboard: { sections: [{ id: 'x', fields: [{ path: 'whitelist', type: 'list', default: [] }] }], actions: [{ id: 'test', run }] } }
  ]);
  const flag = (m, a) => mods.find((x) => x.name === m).actions.find((x) => x.id === a).ownerOnly;
  assert.ok(flag('antinuke', 'panicOn') && flag('antinuke', 'panicOff') && flag('backup', 'createNow') && flag('core-commands', 'reset'));
  assert.ok(!flag('logs', 'test'));
  assert.ok(mods.find((x) => x.name === 'logs').fields.get('whitelist').ownerOnly, 'the bot whitelist is always owner-only');
  // Every loaded module's antinuke section must stay owner-only.
  const real = schema.collect(require('../src/core/loader').loadModules());
  const antinuke = real.find((m) => m.name === 'antinuke');
  if (antinuke) for (const f of antinuke.fields.values()) assert.ok(f.ownerOnly, `antinuke field ${f.path} must be owner-only`);
});

test('schema validation for every field type', () => {
  const f = Object.fromEntries(FIELDS.map((x) => [x.path.split('.')[1], x]));
  const v = (name, value) => schema.validateValue(f[name], value, guild);
  assert.deepEqual(v('enabled', true), { ok: true, value: true });
  assert.equal(v('enabled', 'true').ok, false);
  assert.equal(v('count', 5).value, 5);
  assert.equal(v('count', 0).error, 'min');
  assert.equal(v('count', 11).error, 'max');
  assert.equal(v('count', '5').ok, false);
  assert.equal(v('count', Infinity).ok, false);
  assert.equal(v('count', null).error, 'required');
  assert.equal(v('name', '  ok  ').value, 'ok');
  assert.equal(v('name', 'x'.repeat(11)).error, 'maxLength');
  assert.equal(v('text', 'a\r\nb').value, 'a\nb');
  assert.equal(v('text', 'x'.repeat(4001)).error, 'maxLength');
  assert.equal(v('channel', TEXT).value, TEXT);
  assert.equal(v('channel', VOICE).error, 'wrongChannelType');
  assert.equal(v('channel', '999999999999999999').error, 'unknownChannel');
  assert.equal(v('channel', '../../etc').error, 'type');
  assert.equal(v('channel', null).value, null);
  assert.equal(v('channel', '').value, null);
  assert.equal(v('role', ROLE).value, ROLE);
  assert.equal(v('role', GID).error, 'unknownRole', '@everyone is not a pickable role');
  assert.deepEqual(v('channels', [TEXT, TEXT]).value, [TEXT]);
  assert.equal(v('channels', [TEXT, VOICE, '900000000000000001']).error, 'tooMany');
  assert.equal(v('channels', TEXT).error, 'type');
  assert.deepEqual(v('roles', [ROLE]).value, [ROLE]);
  assert.equal(v('roles', ['700000000000000999']).error, 'unknownRole');
  assert.equal(v('mode', 'ban').value, 'ban');
  assert.equal(v('mode', 'nuke').error, 'option');
  assert.deepEqual(v('words', [' a ', 'a', '', 'b']).value, ['a', 'b']);
  assert.equal(v('words', ['toolong']).error, 'maxLength');
  assert.equal(v('words', ['a', 'b', 'c', 'd']).error, 'tooMany');
  assert.equal(v('words', [1]).error, 'type');
  assert.equal(v('delay', 1500.4).value, 1500);
  assert.equal(v('delay', 10).error, 'min');
  assert.equal(v('delay', 86400001).error, 'max');
  assert.equal(v('delay', -5).ok, false);
  const patch = schema.validatePatch(schema.collect([demoModule]), { 'demo.count': 3, 'other.path': 1 }, guild);
  assert.equal(patch.ok, false);
  assert.equal(patch.errors['other.path'].error, 'unknownField');
  assert.equal(schema.validatePatch(schema.collect([demoModule]), [], guild).ok, false);
});

/** Raw HTTP request (fetch would normalise "../" before sending). */
function raw(port, rawPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test('HTTP server: login, authorization, CSRF, validation, actions, security', async (t) => {
  const { ctx, sent } = makeCtx();
  const dash = createDashboardServer({ ctx, getModules: () => ctx.modules });
  const port = await dash.listen(0, '127.0.0.1');
  t.after(() => dash.close());
  const base = `http://127.0.0.1:${port}`;
  const json = (res) => res.json();

  await t.test('health check and security headers', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    const html = await page.text();
    assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline script');
    assert.equal((await fetch(`${base}/app.js`)).status, 200);
    assert.equal((await fetch(`${base}/style.css`)).headers.get('content-type'), 'text/css; charset=utf-8');
  });

  await t.test('path traversal is impossible', async () => {
    for (const p of ['/../package.json', '/%2e%2e/%2e%2e/package.json', '/app.js/../../index.js', '/public/../lib/auth.js', '/..%2f..%2fpackage.json', '/style.css%00.js', '/index.html']) {
      const res = await raw(port, p);
      assert.ok([404, 401].includes(res.status), `${p} gave ${res.status}`);
      assert.doesNotMatch(res.body, /aclclouds-discord-bot|createAuth|"use strict"|'use strict'/);
    }
  });

  await t.test('anonymous access is refused', async () => {
    const me = await json(await fetch(`${base}/api/me`));
    assert.equal(me.user, null);
    assert.equal(me.oauth, false);
    assert.equal((await fetch(`${base}/api/guilds`)).status, 401);
    assert.equal((await fetch(`${base}/api/guilds/${GID}/config`)).status, 401);
  });

  let cookie;
  let csrf;
  await t.test('magic link logs in once', async () => {
    const token = dash.auth.issueLink(ADMIN, GID);
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Max-Age=604800/);
    cookie = setCookie.split(';')[0];
    const again = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    assert.equal(again.status, 401);
    const me = await json(await fetch(`${base}/api/me`, { headers: { cookie } }));
    assert.equal(me.user.id, ADMIN);
    csrf = me.csrf;
    assert.ok(csrf);
    assert.doesNotMatch(JSON.stringify(me), /secret/i);
  });

  const get = (p) => fetch(`${base}${p}`, { headers: { cookie } });
  const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, body: JSON.stringify(body) });

  await t.test('read endpoints', async () => {
    const guilds = await json(await get('/api/guilds'));
    assert.deepEqual(guilds.guilds.map((g) => g.id), [GID]);
    const overview = await json(await get(`/api/guilds/${GID}/overview`));
    assert.equal(overview.guild.memberCount, 42);
    assert.deepEqual(overview.modules, [{ module: 'demo', enabled: false, protection: false }]);
    const sch = await json(await get(`/api/guilds/${GID}/schema`));
    assert.equal(sch.modules[0].sections[0].fields.length, FIELDS.length);
    assert.equal(sch.isOwner, false);
    assert.equal(sch.modules[0].sections[1].readOnly, true);
    const config = await json(await get(`/api/guilds/${GID}/config`));
    assert.equal(config.values['demo.count'], 5);
    const res = await json(await get(`/api/guilds/${GID}/resources`));
    assert.deepEqual(res.roles.map((r) => r.id), [ROLE]);
    assert.equal(res.channels.length, 2);
    const tr = await json(await get('/api/i18n/en'));
    assert.equal(tr.ui.save, 'Save');
    assert.equal((await get('/api/i18n/xx')).status, 404);
    assert.equal((await get('/api/guilds/123/config')).status, 403);
    assert.equal((await get('/api/guilds/800000000000000009/config')).status, 403);
  });

  await t.test('writes need a CSRF token, JSON and same origin', async () => {
    assert.equal((await post(`/api/guilds/${GID}/config`, { changes: { 'demo.count': 3 } }, { 'X-CSRF-Token': 'nope' })).status, 403);
    const noCsrf = await fetch(`${base}/api/guilds/${GID}/config`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{"changes":{"demo.count":3}}' });
    assert.equal(noCsrf.status, 403);
    const form = await fetch(`${base}/api/guilds/${GID}/config`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=b' });
    assert.equal(form.status, 415);
    assert.equal((await post(`/api/guilds/${GID}/config`, { changes: { 'demo.count': 3 } }, { Origin: 'https://evil.example' })).status, 403);
    const big = await fetch(`${base}/api/guilds/${GID}/config`, { method: 'POST', headers: { cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ changes: { 'demo.text': 'x'.repeat(70000) } }) });
    assert.equal(big.status, 413);
    assert.equal(store.guild(GID).get('demo.count', 5), 5);
  });

  await t.test('config patch is validated, applied and logged', async () => {
    const bad = await post(`/api/guilds/${GID}/config`, { changes: { 'demo.count': 3, 'demo.channel': VOICE } });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).fields['demo.channel'].error, 'wrongChannelType');
    assert.equal(store.guild(GID).get('demo.count', 5), 5, 'nothing is written when one value is invalid');
    const ok = await post(`/api/guilds/${GID}/config`, { changes: { 'demo.count': 3, 'demo.channel': TEXT, 'demo.enabled': true } });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).changed.sort(), ['demo.channel', 'demo.count', 'demo.enabled']);
    assert.equal(store.guild(GID).get('demo.count'), 3);
    assert.equal(store.guild(GID).get('demo.channel'), TEXT);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].category, 'server');
    assert.match(sent[0].embed.data.description, new RegExp(ADMIN));
    const history = store.guild(GID).get('dashboard.history');
    assert.equal(history[0].userId, ADMIN);
  });

  await t.test('owner-only settings and actions are refused to a non-owner admin', async () => {
    const res = await post(`/api/guilds/${GID}/config`, { changes: { whitelist: [ADMIN], 'demo.count': 4 }, lang: 'en' });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'ownerOnly');
    assert.match(body.message, /server owner/);
    assert.equal(store.guild(GID).get('whitelist', null), null, 'whitelist untouched');
    assert.equal(store.guild(GID).get('demo.count'), 3, 'the whole patch is refused');
    assert.equal((await post(`/api/guilds/${GID}/config`, { changes: { 'demo.secret': true } })).status, 403);
    const action = await post(`/api/guilds/${GID}/actions/demo/nuke`, { lang: 'en' });
    assert.equal(action.status, 403);
    assert.match((await action.json()).message, /server owner/);
    assert.equal(nukeRuns, 0);
  });

  await t.test('the guild owner can change owner-only settings', async () => {
    const token = dash.auth.issueLink(OWNER, GID);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const ownerCookie = login.headers.get('set-cookie').split(';')[0];
    const me = await json(await fetch(`${base}/api/me`, { headers: { cookie: ownerCookie } }));
    const h = { cookie: ownerCookie, 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf };
    const sch = await json(await fetch(`${base}/api/guilds/${GID}/schema`, { headers: { cookie: ownerCookie } }));
    assert.equal(sch.isOwner, true);
    assert.equal(sch.modules[0].sections[1].readOnly, false);
    const res = await fetch(`${base}/api/guilds/${GID}/config`, { method: 'POST', headers: h, body: JSON.stringify({ changes: { whitelist: [ADMIN], 'demo.secret': true } }) });
    assert.equal(res.status, 200);
    assert.deepEqual(store.guild(GID).get('whitelist'), [ADMIN]);
    const action = await fetch(`${base}/api/guilds/${GID}/actions/demo/nuke`, { method: 'POST', headers: h, body: '{}' });
    assert.equal(action.status, 200);
    assert.equal(nukeRuns, 1);
  });

  await t.test('actions run and are logged', async () => {
    const res = await post(`/api/guilds/${GID}/actions/demo/reset`, { lang: 'en' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).message, 'Done.');
    assert.equal(actionRuns, 1);
    assert.equal(sent.length, 4);
    assert.equal((await post(`/api/guilds/${GID}/actions/demo/missing`, {})).status, 404);
    assert.equal((await post(`/api/guilds/${GID}/actions/constructor/x`, {})).status, 404);
  });

  await t.test('a member without Manage Server is refused', async () => {
    const token = dash.auth.issueLink(MEMBER, GID);
    const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const memberCookie = res.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/guilds/${GID}/config`, { headers: { cookie: memberCookie } })).status, 403);
    assert.deepEqual((await json(await fetch(`${base}/api/guilds`, { headers: { cookie: memberCookie } }))).guilds, []);
  });

  await t.test('the public URL is learned only from proxied requests with a real host name', async () => {
    await raw(port, '/healthz', { headers: { 'X-Forwarded-Host': '127.0.0.1:3000', 'X-Forwarded-Proto': 'https' } });
    assert.equal(dash.publicUrl.get(), null);
    await raw(port, '/healthz', { headers: { 'X-Forwarded-Host': 'mybot-1a2b.aclclouds.online', 'X-Forwarded-Proto': 'https' } });
    assert.equal(dash.publicUrl.get(), 'https://mybot-1a2b.aclclouds.online');
    await raw(port, '/healthz', { headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' } });
    assert.equal(dash.publicUrl.get(), 'https://mybot-1a2b.aclclouds.online', 'learned once, never overwritten');
    const res = await raw(port, '/', { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(res.headers['strict-transport-security'], /max-age/);
  });

  await t.test('login is rate limited per IP', async () => {
    let last;
    for (let i = 0; i < 12; i++) last = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"token":"x"}' });
    assert.equal(last.status, 429);
  });

  await t.test('logout destroys the session', async () => {
    assert.equal((await post('/logout', {})).status, 200);
    assert.equal((await get('/api/guilds')).status, 401);
  });
});

test('module shape, command data and locale parity', () => {
  assert.equal(dashboardModule.name, 'dashboard');
  const json = dashboardModule.commands[0].data.toJSON();
  assert.equal(json.name, 'dashboard');
  assert.match(json.name, /^[a-z0-9_-]{1,32}$/);
  assert.equal(json.default_member_permissions, String(1n << 5n));
  const keys = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();
  const ref = keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'ar', 'dashboard.json'), 'utf8')));
  for (const lang of ['en']) {
    const other = keys(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', lang, 'dashboard.json'), 'utf8')));
    assert.deepEqual(other, ref, `${lang} keys differ from ar`);
  }
  for (const name of ['app.js', 'render.js', 'pages.js', 'style.css', 'index.html']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'modules', 'dashboard', 'public', name)), name);
  }
});
