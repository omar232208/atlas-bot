'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore, getPath, setPath } = require('../src/core/store');
const { createI18n } = require('../src/core/i18n');
const duration = require('../src/core/duration');
const permissions = require('../src/core/permissions');
const { createCooldowns } = require('../src/core/cooldown');
const { createScheduler } = require('../src/core/scheduler');
const loader = require('../src/core/loader');
const registry = require('../src/core/registry');
const intents = require('../src/core/intents');
const { findComponent } = require('../src/core/interactions');
const check = require('../scripts/check');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `aclbot-${name}-`));

test('store: get / set / update / delete with dot paths', () => {
  const store = createStore({ dir: tmp('store'), debounceMs: 10 });
  const g = store.guild('123');
  assert.equal(g.get('a.b', 'def'), 'def');
  g.set('a.b', 1);
  assert.equal(g.get('a.b'), 1);
  assert.equal(g.update('a.b', (n) => n + 1), 2);
  assert.equal(g.update('list', (l) => [...l, 'x'], []).length, 1);
  assert.equal(g.delete('a.b'), true);
  assert.equal(g.get('a.b', null), null);
  assert.throws(() => store.guild('not-an-id'));
});

test('store: flush writes atomically and survives a cache clear', () => {
  const dir = tmp('flush');
  const store = createStore({ dir, debounceMs: 100000 });
  store.guild('42').set('language', 'de');
  store.global().set('x', true);
  store.flush();
  assert.ok(fs.existsSync(path.join(dir, 'guild-42.json')));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  store.clearCache();
  assert.equal(store.guild('42').get('language'), 'de');
  assert.equal(store.global().get('x'), true);
});

test('store: trim keeps the most recently used files and saves pending changes', () => {
  const dir = tmp('trim');
  const store = createStore({ dir, debounceMs: 100000 });
  for (let i = 1; i <= 5; i++) store.guild(String(i)).set('n', i);
  store.guild('1').get('n');
  assert.equal(store.trim(2), 3);
  assert.equal(store.cacheSize(), 2);
  // Dropped files were written before eviction and are re-read on access.
  assert.equal(store.guild('2').get('n'), 2);
  assert.equal(store.guild('3').get('n'), 3);
});

test('store: path helpers', () => {
  const obj = {};
  setPath(obj, 'x.y.z', 3);
  assert.equal(getPath(obj, 'x.y.z'), 3);
  assert.equal(getPath(obj, ['x', 'y', 'z']), 3);
  assert.equal(getPath(obj, 'x.nope', 'd'), 'd');
});

test('i18n: lookup, interpolation, English fallback, then key', () => {
  const dir = tmp('i18n');
  for (const lang of ['ar', 'en']) fs.mkdirSync(path.join(dir, lang));
  fs.writeFileSync(path.join(dir, 'ar', 'demo.json'), JSON.stringify({ hello: 'Salut {name}', nested: { a: 'A' } }));
  fs.writeFileSync(path.join(dir, 'en', 'demo.json'), JSON.stringify({ hello: 'Hi {name}', nested: { a: 'A' }, onlyEn: 'English' }));
  const store = createStore({ dir: tmp('i18n-store') });
  const i18n = createI18n({ dir, store, defaultLanguage: 'ar' });
  assert.equal(i18n.t('ar', 'demo:hello', { name: 'Ana' }), 'Salut Ana');
  assert.equal(i18n.t('en-US', 'demo:hello', { name: 'Ana' }), 'Hi Ana');
  assert.equal(i18n.t('ar', 'demo:onlyEn'), 'English');
  assert.equal(i18n.t('ar', 'demo:missing'), 'demo:missing');
  assert.equal(i18n.t('ar', 'demo:hello'), 'Salut {name}');
  store.guild('7').set('language', 'en');
  assert.equal(i18n.t({ guildId: '7' }, 'demo:hello', { name: 'x' }), 'Hi x');
  assert.equal(i18n.t({ guildId: '8' }, 'demo:hello', { name: 'x' }), 'Salut x');
  const loc = i18n.localizations('demo:hello');
  assert.equal(loc.ar, 'Salut {name}');
  assert.equal(loc['en-US'], 'Hi {name}');
  assert.equal(i18n.normalize('ar-SA'), 'ar');
  assert.equal(i18n.normalize('en-GB'), 'en');
  assert.equal(i18n.normalize('pt-BR'), null);
});

test('duration: parse', () => {
  assert.equal(duration.parse('10m'), 600000);
  assert.equal(duration.parse('2h30m'), 9000000);
  assert.equal(duration.parse('1w 2d'), 604800000 + 2 * 86400000);
  assert.equal(duration.parse('45'), 45 * 60000);
  assert.equal(duration.parse('0m'), null);
  assert.equal(duration.parse('abc'), null);
  assert.equal(duration.parse(''), null);
  assert.equal(duration.parse(null), null);
});

test('duration: format is localized with singular and plural', () => {
  assert.equal(duration.format(9000000, 'ar'), '2 ساعة 30 دقيقة');
  assert.equal(duration.format(3600000, 'en'), '1 hour');
  assert.equal(duration.format(90061000, 'en', { maxParts: 3 }), '1 day 1 hour 1 minute');
  assert.equal(duration.format(0, 'en'), '0 seconds');
});

test('permissions: canModerate follows role hierarchy', () => {
  const guild = { ownerId: 'owner' };
  const member = (id, position) => ({ id, guild, roles: { highest: { position } } });
  assert.equal(permissions.canModerate(member('a', 5), member('b', 3)), true);
  assert.equal(permissions.canModerate(member('a', 3), member('b', 3)), false);
  assert.equal(permissions.canModerate(member('a', 2), member('b', 3)), false);
  assert.equal(permissions.canModerate(member('a', 9), member('owner', 1)), false);
  assert.equal(permissions.canModerate(member('owner', 1), member('b', 9)), true);
  assert.equal(permissions.canModerate(member('a', 9), member('a', 9)), false);
  assert.equal(permissions.canModerate(null, member('b', 1)), false);
});

test('permissions: owners, whitelist, bot permissions and labels', () => {
  const before = process.env.OWNER_IDS;
  process.env.OWNER_IDS = '111, 222';
  try {
    assert.equal(permissions.isOwner({ ownerId: '9' }, '222'), true);
    assert.equal(permissions.isOwner({ ownerId: '9' }, '9'), true);
    assert.equal(permissions.isOwner({ ownerId: '9' }, '5'), false);
    assert.equal(permissions.isWhitelisted(null, '5'), false);
  } finally {
    process.env.OWNER_IDS = before ?? '';
  }
  const guild = { members: { me: { permissions: { has: (p) => p === 'BanMembers' } } } };
  assert.equal(permissions.botCan(guild, 'BanMembers'), true);
  assert.deepEqual(permissions.botMissing(guild, ['BanMembers', 'KickMembers']), ['KickMembers']);
  assert.equal(permissions.botCan({}, 'BanMembers'), false);
  assert.equal(permissions.permissionLabel('ar', 'BanMembers'), 'حظر الأعضاء');
  assert.equal(permissions.permissionLabel('en', 4n), 'Ban Members');
  assert.equal(permissions.permissionLabel('en', 'NotAFlag'), 'NotAFlag');
});

test('cooldown: hit, remaining and expiry', () => {
  let now = 1000;
  const cd = createCooldowns({ now: () => now });
  assert.equal(cd.hit('k', 5000), 0);
  assert.equal(cd.hit('k', 5000), 5000);
  now += 2000;
  assert.equal(cd.remaining('k'), 3000);
  now += 3001;
  assert.equal(cd.hit('k', 5000), 0);
});

test('scheduler: persists jobs and runs them after start', async () => {
  const store = createStore({ dir: tmp('sched') });
  const scheduler = createScheduler({ store });
  const ran = [];
  scheduler.on('demo:job', (payload) => ran.push(payload));
  const id = scheduler.schedule('demo:job', Date.now() - 1, { n: 1 });
  const cancelled = scheduler.schedule('demo:job', Date.now() + 60000, { n: 2 });
  assert.equal(scheduler.list('demo:job').length, 2);
  assert.equal(scheduler.cancel(cancelled), true);
  scheduler.start();
  await new Promise((r) => setTimeout(r, 30));
  scheduler.stop();
  assert.deepEqual(ran, [{ n: 1 }]);
  assert.equal(scheduler.list().find((j) => j.id === id), undefined);
});

test('loader: discovers modules and rejects broken ones', () => {
  const dir = tmp('modules');
  const write = (name, body) => {
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'index.js'), body);
  };
  const djs = JSON.stringify(require.resolve('discord.js'));
  write('alpha', `const { SlashCommandBuilder } = require(${djs});
module.exports = { name: 'alpha', commands: [{ data: new SlashCommandBuilder().setName('alpha').setDescription('a'), execute() {} }],
  events: [], components: [{ prefix: 'al:', execute() {} }], shutdown() {}, dashboard: { sections: [] } };`);
  write('beta', "module.exports = { name: 'wrong' };");
  const mods = loader.loadModules({ dir });
  assert.equal(mods.length, 1);
  assert.equal(mods[0].commands[0].module, 'alpha');
  assert.equal(typeof mods[0].shutdown, 'function');
  assert.deepEqual(mods[0].dashboard, { sections: [] });
  assert.throws(() => loader.loadModules({ dir, strict: true }), /beta/);
});

test('registry: builds localized command JSON', () => {
  const core = require('../src/modules/core-commands');
  for (const cmd of core.commands) cmd.module = 'core-commands';
  const json = registry.buildCommandJSON(core.commands.find((c) => c.data.name === 'config'));
  assert.equal(json.description_localizations.ar, 'إعدادات البوت لهذا السيرفر');
  const language = json.options.find((o) => o.name === 'language');
  assert.ok(language.description_localizations.ar);
  assert.ok(language.options[0].description_localizations['en-US']);
  assert.deepEqual(json.contexts, [0]);
  for (const cmd of core.commands) assert.deepEqual(check.validateCommandJSON(registry.buildCommandJSON(cmd)), []);
});

test('intents: missing privileged intents come from application flags', () => {
  assert.deepEqual(intents.missingPrivileged(0), ['GuildMembers', 'MessageContent']);
  assert.deepEqual(intents.missingPrivileged((1 << 14) | (1 << 19)), []);
  assert.deepEqual(intents.missingPrivileged(1 << 15), ['MessageContent']);
  const left = intents.withoutIntents(intents.INTENTS, ['MessageContent']);
  assert.equal(left.length, intents.INTENTS.length - 1);
  assert.equal(intents.isDisallowedIntents(new Error('Used disallowed intents')), true);
  assert.equal(intents.isDisallowedIntents(new Error('other')), false);
});

test('interactions: longest component prefix wins', () => {
  const comps = [{ prefix: 'tkt:' }, { prefix: 'tkt:close' }, { prefix: 'core:help:' }];
  assert.equal(findComponent(comps, 'tkt:close:1').prefix, 'tkt:close');
  assert.equal(findComponent(comps, 'tkt:open').prefix, 'tkt:');
  assert.equal(findComponent(comps, 'nope'), null);
});

test('every real module loads and builds valid command JSON', () => {
  const modules = loader.loadModules({ strict: true });
  assert.ok(modules.some((m) => m.name === 'core-commands'));
  for (const json of registry.buildAll(modules)) assert.deepEqual(check.validateCommandJSON(json), [], `/${json.name}`);
});

test('locales: identical key sets in all 5 languages for every namespace', () => {
  const result = check.checkLocales();
  assert.ok(result.namespaces.includes('common'));
  assert.ok(result.namespaces.includes('core-commands'));
  assert.deepEqual(result.errors, []);
});
