'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NS = 'verification';
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
const { SETTINGS, setting, KICK_JOB } = require('../src/modules/verification/lib/config');
const captcha = require('../src/modules/verification/lib/captcha');
const { parseKickAfter } = require('../src/modules/verification/commands/verification');
const mod = require('../src/modules/verification');

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
  // 'verification:kick' is the scheduler job type, not a translation key.
  const keys = [...sources().matchAll(/['`](verification:[\w.]+)['`]/g)].map((m) => m[1]).filter((k) => k !== KICK_JOB);
  assert.ok(keys.length > 30);
  for (const key of new Set(keys)) assert.ok(hasKey(key), `missing ${key}`);
  for (const p of ['managed', 'everyone', 'hierarchy', 'noPermission']) assert.ok(hasKey(`verification:errors.role.${p}`));
});

test('modal texts fit Discord limits with the longest code', () => {
  const code = captcha.spaced('X'.repeat(captcha.MAX_LENGTH));
  for (const lang of LANGS) {
    const data = locale(lang);
    assert.ok(data.modal.label.replace('{code}', code).length <= 45, `${lang} label too long`);
    assert.ok(data.modal.title.length <= 45);
    assert.ok(data.modal.placeholder.length <= 100);
    assert.ok(data.panel.button.length <= 80);
  }
});

test('command is valid, localized and alone in its budget', () => {
  assert.strictEqual(mod.name, NS);
  assert.strictEqual(mod.commands.length, 1);
  const json = registry.buildCommandJSON({ ...mod.commands[0], module: NS });
  assert.strictEqual(json.name, 'verification');
  const check = (o) => {
    assert.ok(o.description.length >= 1 && o.description.length <= 100, o.name);
    for (const v of Object.values(o.description_localizations || {})) assert.ok(v.length <= 100, `${o.name}: ${v}`);
    (o.options || []).forEach(check);
  };
  check(json);
  assert.strictEqual(json.description_localizations.ar, locale('ar').commands.verification.description);
  assert.ok(mod.components.every((c) => c.prefix === 'vrf:'));
});

test('dashboard schema uses the paths and defaults the code reads', () => {
  const g = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'vrf-test-')), debounceMs: 60000 }).guild('1');
  for (const section of mod.dashboard.sections) {
    assert.ok(hasKey(section.title) && hasKey(section.description));
    for (const f of section.fields) {
      assert.ok(Object.prototype.hasOwnProperty.call(SETTINGS, f.path), `unknown path ${f.path}`);
      assert.deepStrictEqual(f.default, SETTINGS[f.path]);
      assert.ok(hasKey(f.label) && hasKey(f.help), f.path);
      assert.deepStrictEqual(setting(g, f.path), SETTINGS[f.path]);
      g.set(f.path, 3);
      assert.strictEqual(setting(g, f.path), 3);
    }
  }
  for (const a of mod.dashboard.actions) assert.ok(hasKey(a.label));
});

test('codes use the unambiguous alphabet and the requested length', () => {
  let i = 0;
  const code = captcha.generateCode(6, (max) => (i++) % max);
  assert.strictEqual(code, 'ABCDEF');
  assert.strictEqual(captcha.generateCode(2).length, captcha.MIN_LENGTH);
  assert.strictEqual(captcha.generateCode(50).length, captcha.MAX_LENGTH);
  for (let n = 0; n < 50; n++) assert.match(captcha.generateCode(8), /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/);
  assert.ok(!/[01IOL]/.test(captcha.ALPHABET));
  assert.strictEqual(captcha.normalize(' k7 p-x '), 'K7PX');
  assert.strictEqual(captcha.spaced('K7PX'), 'K 7 P X');
});

test('challenges: success, wrong answers, lock and expiry', () => {
  let now = 0;
  const book = captcha.createChallenges({ now: () => now, ttlMs: 1000, lockMs: 5000 });
  const rng = () => 0;
  book.issue('g:u', 4, rng);
  assert.deepStrictEqual(book.check('g:u', 'a a a a', 3), { result: 'ok' });
  assert.deepStrictEqual(book.check('g:u', 'AAAA', 3), { result: 'expired' }, 'a code is single-use');

  book.issue('g:u', 4, rng);
  assert.deepStrictEqual(book.check('g:u', 'BBBB', 2), { result: 'wrong', left: 1 });
  book.issue('g:u', 4, rng);
  assert.strictEqual(book.check('g:u', 'BBBB', 2).result, 'locked');
  assert.strictEqual(book.lockedFor('g:u'), 5000);
  book.issue('g:u', 4, rng);
  assert.strictEqual(book.check('g:u', 'AAAA', 2).result, 'locked', 'locked even with the right code');
  now += 5001;
  assert.strictEqual(book.lockedFor('g:u'), 0);
  book.issue('g:u', 4, rng);
  now += 1001;
  assert.strictEqual(book.check('g:u', 'AAAA', 2).result, 'expired');
  book.issue('g:u', 4, rng);
  book.clear('g:u');
  assert.strictEqual(book.check('g:u', 'AAAA', 2).result, 'expired');
});

test('kick_after parsing', () => {
  assert.strictEqual(parseKickAfter(null), null);
  assert.strictEqual(parseKickAfter('0'), 0);
  assert.strictEqual(parseKickAfter('off'), 0);
  assert.strictEqual(parseKickAfter('30m'), 1800000);
  assert.strictEqual(parseKickAfter('1d'), 86400000);
  assert.ok(Number.isNaN(parseKickAfter('10s')), 'below one minute');
  assert.ok(Number.isNaN(parseKickAfter('2w')), 'above seven days');
  assert.ok(Number.isNaN(parseKickAfter('soon')));
});
