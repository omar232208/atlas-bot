'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NS = 'welcome';
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
const i18n = require('../src/core/i18n');
const embeds = require('../src/core/embeds');
const { SETTINGS, setting } = require('../src/modules/welcome/lib/config');
const template = require('../src/modules/welcome/lib/template');
const { buildPayload } = require('../src/modules/welcome/lib/send');
const mod = require('../src/modules/welcome');

const tmpStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-test-')), debounceMs: 60000 });

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
  const keys = [...sources().matchAll(/['`](welcome:[\w.]+)['`]/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const key of new Set(keys)) assert.ok(hasKey(key), `missing ${key}`);
  for (const kind of ['welcome', 'goodbye']) {
    for (const k of ['setTitle', 'setDone', 'messageTitle', 'messageDone', 'showTitle', 'disabledTitle', 'disabledDone']) assert.ok(hasKey(`welcome:${kind}.${k}`), `${kind}.${k}`);
    assert.ok(hasKey(`welcome:defaults.${kind}`));
  }
  for (const p of ['managed', 'everyone', 'hierarchy', 'noPermission']) assert.ok(hasKey(`welcome:autorole.problems.${p}`));
});

test('commands are valid, localized and within the top-level budget', () => {
  assert.strictEqual(mod.name, NS);
  assert.deepStrictEqual(mod.commands.map((c) => c.data.name), ['welcome', 'goodbye', 'autorole']);
  for (const cmd of mod.commands) {
    const json = registry.buildCommandJSON({ ...cmd, module: NS });
    assert.match(json.name, /^[a-z0-9_-]{1,32}$/);
    const check = (o) => {
      assert.ok(o.description.length >= 1 && o.description.length <= 100, o.name);
      for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, `${o.name}: ${v}`);
      (o.options || []).forEach(check);
    };
    check(json);
    assert.ok(json.description_localizations.ar, `${json.name} not localized`);
  }
});

test('dashboard schema uses the paths and defaults the code reads', () => {
  const g = tmpStore().guild('1');
  let count = 0;
  for (const section of mod.dashboard.sections) {
    assert.ok(hasKey(section.title));
    if (section.description) assert.ok(hasKey(section.description));
    for (const f of section.fields) {
      count++;
      assert.ok(Object.prototype.hasOwnProperty.call(SETTINGS, f.path), `unknown path ${f.path}`);
      assert.deepStrictEqual(f.default, SETTINGS[f.path]);
      assert.ok(hasKey(f.label), f.label);
      if (f.help) assert.ok(hasKey(f.help));
      g.set(f.path, 'sentinel');
      assert.strictEqual(setting(g, f.path), 'sentinel');
    }
  }
  assert.strictEqual(count, Object.keys(SETTINGS).length, 'every setting is editable from the dashboard');
  for (const a of mod.dashboard.actions) assert.ok(hasKey(a.label));
  assert.throws(() => setting(g, 'welcome.nope'));
});

test('template rendering', () => {
  const vars = { user: '<@1>', username: 'ana', server: 'Srv', count: 12 };
  assert.strictEqual(template.render('Hi {user} on {SERVER}, #{count}\\nbye {nope}', vars), 'Hi <@1> on Srv, #12\nbye {nope}');
  assert.deepStrictEqual(template.unknownVariables('{user} {foo} {Foo} {count}'), ['foo']);
  assert.ok(template.mentionsUser('hello {User}'));
  assert.ok(!template.mentionsUser('hello {username}'));
});

const fakeMember = (store) => ({
  id: '10',
  displayName: 'Ana',
  user: { id: '10', username: 'ana', bot: false, createdTimestamp: 1700000000000, displayAvatarURL: () => 'https://cdn/avatar.png' },
  guild: { id: '77', name: 'Le Serveur', memberCount: 42 },
  store
});

test('welcome payload: default template, mention only the member, embed toggle', () => {
  const store = tmpStore();
  const ctx = { store, t: i18n.t, embeds };
  const member = fakeMember(store);
  store.guild('77').set('language', 'ar');
  let payload = buildPayload(ctx, member, 'welcome');
  // i18n reads the language from the default store; whichever it is, the default contains {user} and {count}.
  assert.strictEqual(payload.content, '<@10>');
  assert.deepStrictEqual(payload.allowedMentions, { users: ['10'] });
  assert.match(payload.embeds[0].data.description, /42/);
  store.guild('77').set('welcome.message', 'Yo {displayname} ({userid})');
  store.guild('77').set('welcome.embed', false);
  payload = buildPayload(ctx, member, 'welcome');
  assert.strictEqual(payload.content, 'Yo Ana (10)');
  assert.strictEqual(payload.embeds, undefined);
  const goodbye = buildPayload(ctx, member, 'goodbye');
  assert.strictEqual(goodbye.content, undefined, 'goodbye never pings');
  const dm = buildPayload(ctx, member, 'dm');
  assert.strictEqual(dm.embeds[0].data.footer.text, 'Le Serveur');
});
