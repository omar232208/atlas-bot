'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NS = 'community';
const ROOT = path.join(__dirname, '..');
const MOD_DIR = path.join(ROOT, 'src', 'modules', NS);
const LANGS = ['ar', 'en'];

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const locales = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(fs.readFileSync(path.join(ROOT, 'locales', l, `${NS}.json`), 'utf8'))]));
const lookup = (obj, key) => key.split('.').reduce((a, p) => (a && typeof a === 'object' ? a[p] : undefined), obj);
const hasKey = (key) => LANGS.every((l) => typeof lookup(locales[l], key) === 'string');
const sourceFiles = () => {
  const out = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) f.isDirectory() ? walk(path.join(dir, f.name)) : f.name.endsWith('.js') && out.push(path.join(dir, f.name)); };
  walk(MOD_DIR);
  return out;
};

const { createStore } = require('../src/core/store');
const registry = require('../src/core/registry');
const { SETTINGS, setting } = require('../src/modules/community/lib/config');
const S = require('../src/modules/community/lib/suggestions');
const star = require('../src/modules/community/lib/starboard');
const B = require('../src/modules/community/lib/birthdays');
const stats = require('../src/modules/community/lib/stats');
const afk = require('../src/modules/community/lib/afk');
const tags = require('../src/modules/community/lib/tags');
const AR = require('../src/modules/community/lib/autoresponder');
const TV = require('../src/modules/community/lib/tempvoice');
const controls = require('../src/modules/community/lib/tempvoiceControls');
const { fill, clip, serial } = require('../src/modules/community/lib/util');
const mod = require('../src/modules/community');

const tmpStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'community-test-')), debounceMs: 60000 });

test('locale files have identical keys and placeholders in all languages', () => {
  const ref = flatten(locales.ar).sort();
  const vars = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
  for (const lang of LANGS) {
    assert.deepStrictEqual(flatten(locales[lang]).sort(), ref, `key mismatch in ${lang}`);
    for (const key of ref) {
      assert.ok(String(lookup(locales[lang], key)).trim(), `${lang}:${key} empty`);
      assert.strictEqual(vars(lookup(locales[lang], key)), vars(lookup(locales.ar, key)), `${lang}:${key}`);
    }
  }
});

test('every translation key used in the code exists in all languages', () => {
  const keys = new Set();
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\$\{NS\}:([\w.-]+)(?=[`$])/g)) if (!m[1].endsWith('.')) keys.add(m[1]);
    // Keys without a dot are not translations (e.g. the scheduler job "community:birthdays").
    for (const m of src.matchAll(/'community:([\w-]+\.[\w.-]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/(?:fail|ok)\(interaction, ctx, '([\w.]+)'(?:, '([\w.]+)')?/g)) { keys.add(m[1]); if (m[2]) keys.add(m[2]); }
    for (const m of src.matchAll(/\ben\('([\w.-]+)'\)/g)) keys.add(m[1]);
  }
  assert.ok(keys.size > 150, `only ${keys.size} keys found`);
  // Keys built at runtime from fixed value lists.
  for (const s of Object.keys(S.STATUS)) keys.add(`suggestions.status.${s}`);
  for (const s of ['up', 'down']) { keys.add(`suggestions.side.${s}`); keys.add(`suggestions.buttons.${s}`); }
  for (const t of stats.TYPES) { keys.add(`stats.types.${t}`); keys.add(`stats.defaults.${t}`); }
  for (const m of AR.MODES) keys.add(`autoresponder.modes.${m}`);
  for (const m of ['create', 'edit']) keys.add(`tags.modalTitle.${m}`);
  for (const b of ['rename', 'limit', 'lock', 'hide', 'permit', 'kick', 'claim']) keys.add(`tempvoice.buttons.${b}`);
  for (const f of ['locked', 'hidden']) for (const v of ['on', 'off']) keys.add(`tempvoice.${f}.${v}`);
  for (const k of ['permitPrompt', 'kickPrompt', 'renameTitle', 'renameLabel', 'limitTitle', 'limitLabel', 'limitSet', 'limitRemoved']) keys.add(`tempvoice.${k}`);
  for (const k of ['afk.isAfk', 'afk.isAfkReason', 'birthdays.announce', 'birthdays.announceAge', 'common.on', 'common.off', 'starboard.ignored', 'starboard.unignored', 'suggestions.voteSaved', 'suggestions.voteRemoved', 'stats.refreshedWaiting', 'afk.setDescNoNick', 'suggestions.decidedNoMessage']) keys.add(k);
  for (const key of keys) assert.ok(hasKey(key), `missing ${key}`);
});

test('commands build valid localized JSON within the top-level budget', () => {
  assert.strictEqual(mod.name, NS);
  assert.ok(mod.commands.length <= 8, `${mod.commands.length} top-level commands (budget 8)`);
  const names = new Set();
  const walk = (opts) => { for (const o of opts || []) { assert.match(o.name, /^[-_a-z0-9]{1,32}$/); assert.ok(o.description && o.description.length <= 100, o.name); walk(o.options); } };
  for (const cmd of mod.commands) {
    const json = registry.buildCommandJSON({ ...cmd, module: NS });
    assert.match(json.name, /^[a-z]{1,32}$/);
    assert.ok(!names.has(json.name));
    names.add(json.name);
    assert.ok(json.description_localizations.ar, `${json.name} has no French description`);
    walk(json.options);
  }
  assert.deepStrictEqual([...names].sort(), ['afk', 'birthday', 'community', 'starboard', 'suggest', 'suggestion', 'tag', 'tempvoice']);
  const prefixes = mod.components.map((c) => c.prefix);
  assert.strictEqual(new Set(prefixes).size, prefixes.length);
  for (const p of prefixes) assert.ok(p.startsWith('cm') && p.endsWith(':'));
});

test('module loads in strict mode', () => {
  const { loadModules } = require('../src/core/loader');
  const mods = loadModules({ strict: true });
  const loaded = mods.find((m) => m.name === NS);
  assert.ok(loaded);
  assert.strictEqual(loaded.commands.length, mod.commands.length);
});

test('dashboard schema: paths, defaults and labels match the code', () => {
  const sources = sourceFiles().filter((f) => !f.endsWith(path.join('lib', 'dashboard.js')) && !f.endsWith(path.join('lib', 'config.js'))).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const fields = mod.dashboard.sections.flatMap((s) => s.fields);
  assert.ok(fields.length >= 20);
  const types = ['boolean', 'number', 'string', 'text', 'channel', 'role', 'channels', 'roles', 'select', 'list', 'duration'];
  const seen = new Set();
  for (const f of fields) {
    assert.ok(!seen.has(f.path), `duplicate ${f.path}`);
    seen.add(f.path);
    assert.ok(types.includes(f.type), f.path);
    assert.ok(Object.prototype.hasOwnProperty.call(SETTINGS, f.path), `${f.path} not declared in SETTINGS`);
    assert.deepStrictEqual(f.default, SETTINGS[f.path], `default of ${f.path}`);
    // The code must read the same literal path through setting().
    assert.ok(sources.includes(`setting(g, '${f.path}')`) || sources.includes(`'${f.path}')`), `${f.path} is never read by the code`);
    for (const key of [f.label, f.help]) assert.ok(hasKey(key.replace('community:', '')), `missing ${key}`);
    if (typeof f.min === 'number' && typeof f.default === 'number') assert.ok(f.default >= f.min && f.default <= f.max, f.path);
  }
  for (const path of Object.keys(SETTINGS)) assert.ok(seen.has(path), `${path} is missing from the dashboard`);
  for (const s of mod.dashboard.sections) for (const k of [s.title, s.description]) assert.ok(hasKey(k.replace('community:', '')), k);
  for (const a of mod.dashboard.actions) {
    assert.ok(hasKey(a.label.replace('community:', '')), a.label);
    assert.strictEqual(typeof a.run, 'function');
  }
});

test('dashboard actions return existing result keys', async () => {
  const store = tmpStore();
  const guild = { id: '123456789012345678', channels: { cache: new Map() }, members: { cache: new Map() } };
  const ctx = { store, permissions: { botCan: () => false }, t: (l, k) => k, logger: { debug() {}, warn() {} } };
  store.guild(guild.id).set('community.afk.users', { 1: { since: 1 } });
  for (const action of mod.dashboard.actions) {
    const key = await action.run(ctx, guild, '1');
    assert.ok(hasKey(key.replace('community:', '')), `${action.id} -> ${key}`);
  }
  assert.deepStrictEqual(store.guild(guild.id).get('community.afk.users'), {});
});

test('setting() returns declared defaults and stored values', () => {
  const g = tmpStore().guild('1');
  assert.strictEqual(setting(g, 'community.starboard.threshold'), 3);
  g.set('community.starboard.threshold', 7);
  assert.strictEqual(setting(g, 'community.starboard.threshold'), 7);
  g.set('community.starboard.channelId', null);
  assert.strictEqual(setting(g, 'community.starboard.channelId'), null);
  assert.throws(() => setting(g, 'community.nope'));
});

test('suggestion votes toggle and switch sides', () => {
  let item = { up: [], down: [] };
  let r = S.applyVote(item, 'a', 'up');
  assert.deepStrictEqual([r.up, r.down, r.action], [['a'], [], 'added']);
  item = r;
  r = S.applyVote(item, 'a', 'down');
  assert.deepStrictEqual([r.up, r.down, r.action], [[], ['a'], 'switched']);
  r = S.applyVote(r, 'a', 'down');
  assert.deepStrictEqual([r.up, r.down, r.action], [[], [], 'removed']);
  assert.strictEqual(S.voteBar(3, 1, 4), '▰▰▰▱ 75%');
  assert.strictEqual(S.voteBar(0, 0, 4), '▱▱▱▱ 0%');
  assert.deepStrictEqual(S.parseVoteId('cmsug:down:42'), { side: 'down', number: 42 });
  assert.strictEqual(S.parseVoteId('cmsug:maybe:1'), null);
  assert.ok(S.isLocked('accepted') && S.isLocked('denied') && !S.isLocked('considered'));
});

test('suggestion embed and buttons render', () => {
  const t = (lang, key, vars) => `${key}${vars ? JSON.stringify(vars) : ''}`;
  const item = { number: 5, content: 'More emojis', status: 'denied', up: ['1'], down: [], authorId: '9', reason: 'no', staffId: '2' };
  const embed = S.buildEmbed(t, 'en', item, { anonymous: true }).toJSON();
  assert.strictEqual(embed.color, S.STATUS.denied);
  assert.strictEqual(embed.fields.length, 3);
  const row = S.buildButtons(t, 'en', item)[0].toJSON();
  assert.ok(row.components.every((c) => c.disabled));
  assert.strictEqual(row.components[0].custom_id, 'cmsug:up:5');
});

test('starboard emoji parsing and counting', () => {
  assert.strictEqual(star.parseEmoji('⭐'), '⭐');
  assert.strictEqual(star.parseEmoji('<:star:123456789012345678>'), '<:star:123456789012345678>');
  assert.strictEqual(star.parseEmoji('star'), null);
  assert.strictEqual(star.parseEmoji(''), null);
  assert.ok(star.emojiMatches({ id: null, name: '⭐' }, '⭐'));
  assert.ok(star.emojiMatches({ id: '123456789012345678', name: 'star' }, '<:star:123456789012345678>'));
  assert.ok(!star.emojiMatches({ id: '1', name: '⭐' }, '⭐'));
  assert.strictEqual(star.routeEmoji('<a:s:123456789012345678>'), 's:123456789012345678');
  assert.strictEqual(star.routeEmoji('⭐'), encodeURIComponent('⭐'));
  const users = [{ id: 'author' }, { id: 'a' }, { id: 'bot', bot: true }, { id: 'b' }];
  assert.strictEqual(star.countStars(users, 'author', false), 2);
  assert.strictEqual(star.countStars(users, 'author', true), 3);
});

test('birthday date logic', () => {
  assert.ok(B.isValidDate(29, 2, null));
  assert.ok(B.isValidDate(29, 2, 2000, 2026));
  assert.ok(!B.isValidDate(29, 2, 2001, 2026));
  assert.ok(!B.isValidDate(31, 4));
  assert.ok(!B.isValidDate(1, 13));
  assert.ok(!B.isValidDate(1, 1, 2030, 2026));
  const at = Date.UTC(2026, 10, 14, 23, 30);
  assert.strictEqual(B.localNow(0, at).key, '2026-11-14');
  assert.strictEqual(B.localNow(1, at).key, '2026-11-15');
  assert.strictEqual(B.localNow(-5, at).hour, 18);
  const local = { year: 2027, month: 2, day: 28 };
  assert.ok(B.isToday({ day: 29, month: 2 }, local));
  assert.ok(!B.isToday({ day: 29, month: 2 }, { year: 2028, month: 2, day: 28 }));
  assert.strictEqual(B.daysUntil({ day: 1, month: 3 }, local), 1);
  assert.strictEqual(B.daysUntil({ day: 27, month: 2 }, local), 364);
  assert.strictEqual(B.upcomingAge({ day: 28, month: 2, year: 2000 }, local), 27);
  assert.strictEqual(B.upcomingAge({ day: 1, month: 1, year: 2000 }, local), 28);
  assert.strictEqual(B.upcomingAge({ day: 1, month: 1 }, local), null);
  const order = B.upcoming({ a: { day: 1, month: 5 }, b: { day: 28, month: 2 }, c: { day: 3, month: 3 } }, local).map((r) => r.userId);
  assert.deepStrictEqual(order, ['b', 'c', 'a']);
  assert.strictEqual(B.nextHour(Date.UTC(2026, 0, 1, 10, 15)), Date.UTC(2026, 0, 1, 11, 0) + 5000);
});

test('birthday tick announces once and removes yesterday roles', async () => {
  const store = tmpStore();
  const gid = '42';
  const g = store.guild(gid);
  g.set('community.birthdays.enabled', true);
  g.set('community.birthdays.channelId', 'c1');
  g.set('community.birthdays.hour', 0);
  g.set('community.birthdays.users', { u1: { day: 14, month: 11, year: 2000 }, u2: { day: 1, month: 1 } });
  g.set('community.birthdays.state', { holders: [{ userId: 'old', roleId: 'r', date: '2026-11-13' }] });
  const sent = [];
  const removed = [];
  const member = (id) => ({ id, user: { username: id }, roles: { add: async () => {}, remove: async (r) => removed.push([id, r]) } });
  const guild = {
    id: gid,
    name: 'Srv',
    members: { fetch: async (id) => member(id) },
    roles: { cache: new Map() },
    channels: { cache: new Map([['c1', { isTextBased: () => true, send: async (p) => sent.push(p) }]]) }
  };
  const ctx = { store, permissions: { botCan: () => true }, t: (l, k, v) => `${k}:${v?.age ?? ''}`, embeds: require('../src/core/embeds'), logger: { warn() {} } };
  const now = Date.UTC(2026, 10, 14, 12);
  await B.tickGuild(ctx, guild, now);
  await B.tickGuild(ctx, guild, now + 3600000);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().description, /announceAge:26/);
  assert.deepStrictEqual(sent[0].allowedMentions.users, ['u1']);
  assert.deepStrictEqual(removed, [['old', 'r']]);
  assert.strictEqual(g.get('community.birthdays.state').lastRun, '2026-11-14');
});

test('stats rename limiter and rendering', () => {
  let now = 0;
  const lim = stats.createRenameLimiter({ now: () => now });
  assert.strictEqual(lim.waitMs('c'), 0);
  lim.record('c'); lim.record('c');
  assert.strictEqual(lim.waitMs('c'), 600000);
  now = 300000;
  assert.strictEqual(lim.waitMs('c'), 300000);
  now = 600001;
  assert.strictEqual(lim.waitMs('c'), 0);
  assert.strictEqual(stats.render('Membres : {count}', 12345, 'en').replace(/\s/g, ' '), 'Membres : 12,345');
  assert.strictEqual(stats.render('Members: {count}', 12345, 'en-US'), 'Members: 12,345');
  assert.strictEqual(stats.render('x'.repeat(150) + '{count}', 1).length, 100);
  const guild = { memberCount: 10, premiumSubscriptionCount: 3, premiumTier: 1, channels: { cache: { size: 5 } }, roles: { cache: { size: 4 } }, members: { cache: new Map() } };
  assert.deepStrictEqual(stats.counts(guild, 2), { members: 10, humans: 8, bots: 2, boosts: 3, tier: 1, channels: 5, roles: 3 });
});

test('afk nickname helpers and mention detection', () => {
  assert.strictEqual(afk.tagName('Bob'), '[AFK] Bob');
  assert.strictEqual(afk.tagName('[AFK] Bob'), '[AFK] Bob');
  assert.strictEqual(afk.tagName('x'.repeat(40)).length, 32);
  assert.strictEqual(afk.untagName('[AFK] Bob'), 'Bob');
  assert.strictEqual(afk.untagName('Bob'), 'Bob');
  assert.deepStrictEqual(afk.addressedAfk(['a', 'b', 'a', 'me'], { a: {}, me: {} }, 'me'), ['a']);
});

test('tag names, search and rendering', () => {
  assert.strictEqual(tags.normalizeName('  Règles Serveur '), 'règles-serveur');
  assert.ok(tags.isValidName('règles-serveur'));
  assert.ok(!tags.isValidName('a.b'));
  assert.ok(!tags.isValidName('x'.repeat(33)));
  assert.ok(!tags.isValidName(''));
  assert.deepStrictEqual(tags.searchNames(['rules', 'faq', 'server-rules', 'roles'], 'ru'), ['rules', 'server-rules']);
  assert.strictEqual(tags.searchNames(['b', 'a'], '').join(), 'a,b');
  assert.strictEqual(tags.renderTag('Hi {target}, see {server} {unknown}', { target: '<@1>', server: 'S' }), 'Hi <@1>, see S {unknown}');
  const modal = tags.modal('en', (l, k) => k, 'edit', 'faq', 'old').toJSON();
  assert.strictEqual(modal.custom_id, 'cmtag:edit:faq');
});

test('auto-responder matching', () => {
  assert.ok(AR.matches('Bonjour  à TOUS', { trigger: 'bonjour a tous', mode: 'exact' }));
  assert.ok(AR.matches('well hello there', { trigger: 'hello', mode: 'contains' }));
  assert.ok(!AR.matches('well hello', { trigger: 'hello', mode: 'startswith' }));
  assert.ok(AR.matches('hi, all', { trigger: 'hi', mode: 'word' }));
  assert.ok(!AR.matches('this', { trigger: 'hi', mode: 'word' }));
  assert.ok(AR.matches('c++ rocks', { trigger: 'c++', mode: 'word' }));
  const rules = [{ id: 1, trigger: 'help', mode: 'contains' }, { id: 2, trigger: 'help', mode: 'exact' }];
  assert.strictEqual(AR.findRule('help', rules).id, 2);
  assert.strictEqual(AR.findRule('need help', rules).id, 1);
  assert.strictEqual(AR.findRule('nothing', rules), null);
});

test('temp voice helpers', () => {
  assert.strictEqual(TV.channelName('Salon de {user}', 'Alice'), 'Salon de Alice');
  assert.strictEqual(TV.channelName('', 'Alice'), 'Alice');
  assert.deepStrictEqual(controls.parseId('cmtv:mrename:123'), { action: 'mrename', channelId: '123' });
  assert.strictEqual(controls.parseId('cmtv:nuke:123'), null);
  const parent = { permissionOverwrites: { cache: new Map([['owner', { id: 'owner', type: 1, allow: { bitfield: 0n }, deny: { bitfield: 1024n } }], ['r', { id: 'r', type: 0, allow: { bitfield: 0n }, deny: { bitfield: 1024n } }]]) } };
  const ow = TV.overwritesFor(parent, 'owner', 'bot');
  assert.strictEqual(ow.length, 3);
  assert.strictEqual(ow.find((o) => o.id === 'owner').deny, 0n);
  const panel = TV.panel((l, k) => k, 'en', '55', '1');
  const ids = panel.components.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));
  assert.ok(ids.every((id) => controls.parseId(id)?.channelId === '55'));
});

test('utility helpers', async () => {
  assert.strictEqual(fill('{a}-{b}', { a: 1 }), '1-{b}');
  assert.strictEqual(clip('abcdef', 4), 'abc…');
  const order = [];
  await Promise.all([
    serial('k', async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); }),
    serial('k', async () => { order.push(2); })
  ]);
  assert.deepStrictEqual(order, [1, 2]);
});
