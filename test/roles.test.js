'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const NS = 'roles';
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

const { roleProblem, DEFAULTS, DANGEROUS } = require('../src/modules/roles/lib/util');
const menus = require('../src/modules/roles/lib/menus');
const temp = require('../src/modules/roles/lib/temp');
const roleCmd = require('../src/modules/roles/commands/role');
const rolemenuCmd = require('../src/modules/roles/commands/rolemenu');
const mod = require('../src/modules/roles');
const { createScheduler } = require('../src/core/scheduler');

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

test('commands build with valid names and localized descriptions under 100 chars', () => {
  const { buildCommandJSON } = require('../src/core/registry');
  for (const cmd of [roleCmd, rolemenuCmd]) {
    const json = buildCommandJSON({ ...cmd, module: NS });
    assert.match(json.name, /^[a-z]{1,32}$/);
    assert.ok(json.description.length <= 100);
    assert.notStrictEqual(json.description, json.name === 'role' ? 'Roles' : 'Role menus', `${json.name} not localized`);
    const check = (opts) => {
      for (const o of opts || []) {
        assert.match(o.name, /^[a-z0-9_-]{1,32}$/);
        assert.ok(o.description && o.description.length <= 100, `description of ${o.name}`);
        assert.notStrictEqual(o.description, o.name, `option ${json.name}.${o.name} not localized`);
        for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, `${o.name}: ${v}`);
        for (const c of o.choices || []) assert.ok(c.name_localizations?.ar, `choice ${o.name}.${c.value}`);
        check(o.options);
      }
    };
    check(json.options);
  }
});

test('module shape and dashboard paths', () => {
  assert.strictEqual(mod.name, NS);
  assert.deepStrictEqual(mod.components.map((c) => c.prefix), ['rmenu:']);
  const src = sources();
  for (const field of mod.dashboard.sections.flatMap((s) => s.fields)) {
    assert.ok(field.path.startsWith('roles.config.'), field.path);
    const key = field.path.slice('roles.config.'.length);
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULTS, key), key);
    assert.deepStrictEqual(field.default, DEFAULTS[key]);
    assert.ok(src.includes(`.${key}`), `${key} never read`);
  }
});

test('roleProblem enforces hierarchy and safety', () => {
  const env = { guildId: 'g', botTop: 10, actorTop: 8, actorIsOwner: false };
  const perms = (dangerous) => ({ has: () => dangerous });
  assert.strictEqual(roleProblem(null, env), 'errors.roleGone');
  assert.strictEqual(roleProblem({ id: 'g', position: 0 }, env), 'errors.everyone');
  assert.strictEqual(roleProblem({ id: 'r', managed: true, position: 1 }, env), 'errors.managed');
  assert.strictEqual(roleProblem({ id: 'r', position: 10 }, env), 'errors.botHierarchy');
  assert.strictEqual(roleProblem({ id: 'r', position: 9 }, env), 'errors.userHierarchy');
  assert.strictEqual(roleProblem({ id: 'r', position: 9 }, { ...env, actorIsOwner: true }), null);
  assert.strictEqual(roleProblem({ id: 'r', position: 2, permissions: perms(true) }, { ...env, selfService: true }), 'errors.dangerous');
  assert.strictEqual(roleProblem({ id: 'r', position: 2, permissions: perms(true) }, env), null);
  assert.strictEqual(roleProblem({ id: 'r', position: 2, permissions: perms(false) }, { ...env, selfService: true }), null);
  assert.ok(DANGEROUS.length >= 5);
});

test('computeChanges for buttons', () => {
  const menu = (mode) => ({ type: 'buttons', mode, items: [{ roleId: 'a' }, { roleId: 'b' }, { roleId: 'c' }] });
  assert.deepStrictEqual(menus.computeChanges(menu('toggle'), ['a'], 'a'), { add: [], remove: ['a'] });
  assert.deepStrictEqual(menus.computeChanges(menu('toggle'), [], 'b'), { add: ['b'], remove: [] });
  assert.deepStrictEqual(menus.computeChanges(menu('unique'), ['a', 'c'], 'b'), { add: ['b'], remove: ['a', 'c'] });
  assert.deepStrictEqual(menus.computeChanges(menu('add'), ['a'], 'a'), { add: [], remove: [] });
  assert.deepStrictEqual(menus.computeChanges(menu('remove'), [], 'a'), { add: [], remove: [] });
  assert.deepStrictEqual(menus.computeChanges(menu('remove'), ['a'], 'a'), { add: [], remove: ['a'] });
  assert.deepStrictEqual(menus.computeChanges(menu('toggle'), [], 'zzz'), { add: [], remove: [] });
});

test('computeChanges for selects', () => {
  const menu = (mode) => ({ type: 'select', mode, items: [{ roleId: 'a' }, { roleId: 'b' }, { roleId: 'c' }] });
  assert.deepStrictEqual(menus.computeChanges(menu('toggle'), ['a'], ['a', 'b']), { add: ['b'], remove: ['a'] });
  assert.deepStrictEqual(menus.computeChanges(menu('unique'), ['a'], ['c']), { add: ['c'], remove: ['a'] });
  assert.deepStrictEqual(menus.computeChanges(menu('unique'), ['c'], ['c']), { add: [], remove: ['c'] });
  assert.deepStrictEqual(menus.computeChanges(menu('add'), ['a'], ['a', 'b', 'x']), { add: ['b'], remove: [] });
  assert.deepStrictEqual(menus.computeChanges(menu('remove'), ['a'], ['a', 'b']), { add: [], remove: ['a'] });
});

test('createMenu and findMenu', () => {
  const data = {};
  const store = { guild: () => ({ get: (p, d) => require('../src/core/store').getPath(data, p, d), set: (p, v) => require('../src/core/store').setPath(data, p, v) }) };
  const menu = menus.createMenu(store, '1', { name: 'Colours', type: 'buttons', mode: 'toggle' });
  assert.strictEqual(typeof menu, 'object');
  assert.strictEqual(menus.findMenu(store, '1', 'colours').id, menu.id);
  assert.strictEqual(menus.findMenu(store, '1', menu.id).name, 'Colours');
  assert.strictEqual(menus.createMenu(store, '1', { name: 'COLOURS', type: 'select', mode: 'toggle' }), 'errors.menuExists');
});

test('parseEmoji', () => {
  assert.strictEqual(menus.parseEmoji('🔥'), '🔥');
  assert.deepStrictEqual(menus.parseEmoji('<a:wave:123456789012345678>'), { name: 'wave', id: '123456789012345678', animated: true });
  assert.strictEqual(menus.parseEmoji('hello'), undefined);
});

test('massTargets filters by action and target', () => {
  const m = (id, bot, roles) => ({ id, user: { bot }, roles: { cache: new Set(roles) } });
  const list = [m('1', false, ['r']), m('2', false, []), m('3', true, [])];
  assert.deepStrictEqual(roleCmd.massTargets(list, 'r', 'add', 'all').map((x) => x.id), ['2', '3']);
  assert.deepStrictEqual(roleCmd.massTargets(list, 'r', 'add', 'humans').map((x) => x.id), ['2']);
  assert.deepStrictEqual(roleCmd.massTargets(list, 'r', 'remove', 'all').map((x) => x.id), ['1']);
  assert.deepStrictEqual(roleCmd.massTargets(list, 'r', 'add', 'bots').map((x) => x.id), ['3']);
});

test('progress bar', () => {
  assert.strictEqual(roleCmd.bar(0.5), '`[##########----------]` 50%');
  assert.strictEqual(roleCmd.bar(2), '`[####################]` 100%');
});

test('temp roles: schedule replaces the previous expiry, cancel removes it', () => {
  const data = {};
  const { getPath, setPath } = require('../src/core/store');
  const fakeStore = { global: () => ({ get: (p, d) => getPath(data, p, d), set: (p, v) => setPath(data, p, v), delete: (p) => { const keys = p.split('.'); const last = keys.pop(); const parent = getPath(data, keys); if (!parent || !(last in parent)) return false; delete parent[last]; return true; } }) };
  const scheduler = createScheduler({ store: fakeStore });
  temp.schedule(scheduler, 'g', 'u', 'r', Date.now() + 60000, 'm');
  temp.schedule(scheduler, 'g', 'u', 'r', Date.now() + 120000, 'm');
  temp.schedule(scheduler, 'g', 'u2', 'r', Date.now() + 60000, 'm');
  assert.strictEqual(temp.pending(scheduler, 'g').length, 2);
  assert.strictEqual(temp.pending(scheduler, 'g', { userId: 'u' }).length, 1);
  assert.strictEqual(temp.cancel(scheduler, 'g', 'u', 'r'), 1);
  assert.strictEqual(temp.pending(scheduler, 'g', { roleId: 'r' }).length, 1);
  assert.strictEqual(temp.pending(scheduler, 'other').length, 0);
});
