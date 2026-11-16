'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-automod-'));

const i18n = require('../src/core/i18n');
const embeds = require('../src/core/embeds');
const registry = require('../src/core/registry');
const { createStore } = require('../src/core/store');
const automod = require('../src/modules/automod');
const F = require('../src/modules/automod/lib/filters');
const { createTracker } = require('../src/modules/automod/lib/spam');
const E = require('../src/modules/automod/lib/escalation');
const C = require('../src/modules/automod/lib/config');
const { parseWords } = require('../src/modules/automod/commands/badwords');
const handler = require('../src/modules/automod/lib/handler');

/** A store handle with no saved values, so getConfig returns defaults. */
const empty = { get: (p, d) => d };
const allOn = () => {
  const cfg = C.getConfig(empty);
  for (const f of Object.values(cfg.filters)) f.enabled = true;
  return cfg;
};

test('automod: 3 valid, fully localized top-level commands', () => {
  assert.equal(automod.name, 'automod');
  assert.deepEqual(automod.commands.map((c) => c.data.name), ['automod', 'badwords', 'links']);
  for (const cmd of automod.commands) {
    const json = registry.buildCommandJSON({ ...cmd, module: 'automod' });
    const walk = (node, where) => {
      for (const lang of ['ar', 'en-US', 'en-GB']) {
        const text = node.description_localizations?.[lang];
        assert.ok(text, `missing ${lang} description for ${where}`);
        assert.ok(text.length <= 100, `${where} (${lang}) longer than 100 characters`);
      }
      for (const choice of node.choices || []) assert.ok(choice.name_localizations?.ar, `${where} choice ${choice.value}`);
      for (const opt of node.options || []) walk(opt, `${where} ${opt.name}`);
    };
    walk(json, `/${json.name}`);
  }
});

test('automod: locale key parity and placeholders across the 5 languages', () => {
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
  const load = (l) => new Map(flat(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', l, 'automod.json'), 'utf8'))));
  const fr = load('ar');
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const lang of ['en']) {
    const other = load(lang);
    assert.deepEqual([...other.keys()].sort(), [...fr.keys()].sort(), `${lang} keys differ from ar`);
    for (const [k, v] of fr) assert.equal(vars(other.get(k)), vars(v), `${lang}:${k} placeholders`);
  }
});

test('automod: every static and generated key exists', () => {
  const dir = path.join(__dirname, '..', 'src', 'modules', 'automod');
  for (const f of fs.readdirSync(dir, { recursive: true }).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const [, key] of src.matchAll(/'(automod:[a-zA-Z]+\.[a-zA-Z.]*[a-zA-Z])'/g)) assert.ok(i18n.has('ar', key), `${f}: ${key}`);
  }
  for (const name of F.FILTER_ORDER) {
    for (const k of ['name', 'description', 'threshold']) assert.ok(i18n.has('ar', `automod:filters.${name}.${k}`), `${name}.${k}`);
    assert.ok(i18n.has('ar', `automod:reasons.${name}`));
  }
  for (const a of E.ACTIONS) assert.ok(i18n.has('ar', `automod:actions.${a}`) && i18n.has('ar', `automod:notice.${a}`));
});

test('automod: dashboard fields are exactly what getConfig reads, with the same defaults', () => {
  const reads = new Map();
  const recorder = { get: (p, d) => { reads.set(p, d); return d; } };
  C.getConfig(recorder);
  const seen = new Set();
  for (const section of automod.dashboard.sections) {
    assert.ok(i18n.has('ar', section.title) && i18n.has('ar', section.description), section.id);
    for (const field of section.fields) {
      assert.ok(reads.has(field.path), `${field.path} is never read by getConfig`);
      assert.deepEqual(field.default, reads.get(field.path), `${field.path} default`);
      assert.ok(i18n.has('ar', field.label) && i18n.has('ar', field.help), field.label);
      for (const o of field.options || []) assert.ok(i18n.has('ar', o.label), o.label);
      seen.add(field.path);
    }
  }
  // Escalation steps are structured objects: configured with /automod escalation only.
  const notOnDashboard = [...reads.keys()].filter((p) => !seen.has(p));
  assert.deepEqual(notOnDashboard, [C.GLOBAL.escalation.path]);
  assert.equal(C.GLOBAL.enabled.path, 'automod.enabled', '/setup writes this path');
  assert.ok(i18n.has('ar', automod.dashboard.actions[0].label));
});

test('automod: dashboard action resets strikes', async () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-am-')), debounceMs: 5 });
  store.guild('5').set(`${C.STRIKES}.1`, [1, 2]);
  const key = await automod.dashboard.actions[0].run({ store }, { id: '5' }, '1');
  assert.equal(store.guild('5').get(C.STRIKES), undefined);
  assert.ok(i18n.has('ar', key));
});

test('filters: banned words with wildcards, accents, leet and spacing', () => {
  const words = ['idiot', 'spam*', '*crap*'];
  assert.equal(F.findBadWord('you are an IDIOT', words), 'idiot');
  assert.equal(F.findBadWord('you are an 1d10t', words), 'idiot');
  assert.equal(F.findBadWord('you are an i d i o t', words), 'idiot');
  assert.equal(F.findBadWord('you are an i.d.i.o.t', words), 'idiot');
  assert.equal(F.findBadWord('ídíót', words), 'idiot');
  assert.equal(F.findBadWord('id​iot', words), 'idiot', 'zero-width characters are ignored');
  assert.equal(F.findBadWord('idiotic remark', words), null, 'whole word only without wildcard');
  assert.equal(F.findBadWord('spammer here', words), 'spam*');
  assert.equal(F.findBadWord('antispam', words), null);
  assert.equal(F.findBadWord('supercrapware', words), '*crap*');
  assert.equal(F.findBadWord('hello', []), null);
  assert.equal(F.compileWord('***'), null);
});

test('filters: invites, including spaced-out ones', () => {
  assert.deepEqual(F.findInvites('join discord.gg/AbC123 now'), ['abc123']);
  assert.deepEqual(F.findInvites('https://discord.com/invite/xyz and discordapp.com/invite/xyz'), ['xyz']);
  assert.deepEqual(F.findInvites('discord . gg / sneaky'), ['sneaky']);
  assert.deepEqual(F.findInvites('I like discord'), []);
});

test('filters: links with allow and deny lists', () => {
  assert.deepEqual(F.extractDomains('see https://www.Example.org/page and youtu.be/x'), ['example.org', 'youtu.be']);
  assert.deepEqual(F.extractDomains('go to evil.com now'), ['evil.com']);
  assert.deepEqual(F.extractDomains('version 1.2.3, file.txt, mr.smith'), []);
  const links = { mode: 'allowlist', allow: ['youtube.com'], deny: ['bad.io'] };
  assert.deepEqual(F.blockedDomains('https://m.youtube.com/watch https://other.net', links), ['other.net']);
  assert.deepEqual(F.blockedDomains('https://other.net https://x.bad.io', { ...links, mode: 'denylist' }), ['x.bad.io']);
  assert.equal(F.normalizeDomain('HTTPS://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(F.normalizeDomain('not a domain'), null);
  assert.ok(F.domainInList('a.b.example.com', ['example.com']));
  assert.ok(!F.domainInList('notexample.com', ['example.com']));
});

test('filters: caps, zalgo, emojis, lines, mentions', () => {
  assert.equal(F.capsStats('HELLO EVERYONE').ratio, 1);
  assert.ok(F.capsStats('Hello everyone <@123456789012345678> https://EXAMPLE.COM').ratio < 0.2, 'mentions and links are ignored');
  assert.equal(F.capsStats('```SHOUTED CODE``` ok').letters, 2);
  assert.ok(F.zalgoStack('h́̂̃̄̅i') >= 5);
  assert.equal(F.zalgoStack('cafe\u0301 nai\u0308ve'), 1, 'one accent is not zalgo');
  assert.equal(F.zalgoStack('नमस्ते'), 0, 'Devanagari marks are not zalgo');
  assert.equal(F.countEmojis('hi 😀😀 <:pepe:123456789012345678> <a:dance:123456789012345678>'), 4);
  assert.equal(F.countLines('a\nb\nc'), 2);
  assert.equal(F.countMentionsInText('<@123456789012345678> <@!123456789012345678> <@&223456789012345678> @everyone'), 3);
  assert.equal(F.fingerprint('  Hello   WORLD '), 'hello world');
});

test('detect: order, thresholds and disabled filters', () => {
  const cfg = allOn();
  cfg.badwords = ['idiot'];
  const hits = F.detect({ content: 'IDIOT discord.gg/abc', mentions: 0 }, cfg, null).map((h) => h.filter);
  assert.deepEqual(hits.slice(0, 2), ['badwords', 'invites']);
  assert.ok(hits.includes('links'), 'an invite is also a link');
  assert.deepEqual(F.detect({ content: 'discord.gg/home', ownInvites: ['home'] }, { ...cfg, links: { mode: 'denylist', allow: [], deny: [] } }, null), [], 'own invites allowed');
  assert.equal(F.detect({ content: 'hey', mentions: 5 }, cfg, null)[0].filter, 'mentions');
  assert.equal(F.detect({ content: 'hey', mentions: 4 }, cfg, null).length, 0);
  const spam = F.detect({ content: 'hey' }, cfg, { messages: 6, duplicates: 0, attachments: 0 });
  assert.deepEqual(spam[0], { filter: 'spam', detail: { count: 6, seconds: 5 } });
  assert.equal(F.detect({ content: 'SHORT CAPS' }, cfg, null).length, 0, 'below the minimum length');
  assert.equal(F.detect({ content: 'THIS IS A LONG SHOUTED MESSAGE' }, cfg, null)[0].filter, 'caps');
  const defaults = C.getConfig(empty);
  assert.equal(F.detect({ content: 'THIS IS A LONG SHOUTED MESSAGE' }, defaults, null).length, 0, 'caps is off by default');
});

test('spam tracker: rates, duplicates, attachments, recent ids', () => {
  let now = 0;
  const tr = createTracker({ now: () => now });
  const w = { spamSeconds: 5, duplicateSeconds: 30, attachmentSeconds: 15 };
  let s;
  for (let i = 0; i < 5; i++) { now += 500; s = tr.record('g:u', { messageId: `m${i}`, channelId: i < 3 ? 'c1' : 'c2', content: 'Buy now', attachments: 1 }, w); }
  assert.deepEqual(s, { messages: 5, duplicates: 5, attachments: 5 });
  now += 6000;
  s = tr.record('g:u', { messageId: 'm5', channelId: 'c1', content: '' }, w);
  assert.equal(s.messages, 1, 'old messages leave the spam window');
  assert.equal(s.duplicates, 0, 'messages without text are never duplicates');
  assert.equal(s.attachments, 5);
  assert.deepEqual([...tr.recentIds('g:u', 30).entries()], [['c1', ['m0', 'm1', 'm2', 'm5']], ['c2', ['m3', 'm4']]]);
  tr.reset('g:u');
  assert.equal(tr.recentIds('g:u', 30).size, 0);
});

test('escalation: strikes window, steps and harsher action', () => {
  assert.deepEqual(E.activeStrikes([1, 50, 100], 61, 110), [50, 100]);
  assert.equal(E.addStrike([1, 2], 0, 3).length, 3, 'window 0 = never expire');
  assert.equal(E.addStrike(Array.from({ length: 150 }, (_, i) => i), 0, 999).length, 100);
  const steps = E.normalizeSteps([{ strikes: 5, action: 'kick' }, { strikes: 3, action: 'timeout', duration: 600000 }, { strikes: 2, action: 'delete' }]);
  assert.deepEqual(steps.map((s) => s.strikes), [3, 5]);
  assert.equal(E.stepFor(2, steps), null);
  assert.equal(E.stepFor(4, steps).action, 'timeout');
  assert.equal(E.stepFor(9, steps).action, 'kick', 'past the last step keeps the last one');
  assert.deepEqual(E.pickAction({ action: 'delete' }, null), { action: 'delete', escalated: false });
  assert.equal(E.pickAction({ action: 'delete' }, { action: 'timeout', duration: 5 }).escalated, true);
  assert.equal(E.pickAction({ action: 'ban' }, { action: 'timeout' }).action, 'ban', 'never milder than the filter');
  assert.deepEqual(E.pickAction({ action: 'timeout', duration: 10 }, { action: 'timeout', duration: 60 }), { action: 'timeout', duration: 60, escalated: true });
});

test('badwords: parsing the comma separated input', () => {
  assert.deepEqual(parseWords(' Foo, bar* ,foo,, *, ' + 'x'.repeat(60)), ['foo', 'bar*']);
});

test('handler: deletes an invite, adds a strike and logs it', async () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-am-h-')), debounceMs: 5 });
  const gs = store.guild('77');
  gs.set(C.GLOBAL.enabled.path, true);
  const done = [];
  const logs = [];
  const roles = new Map();
  const channel = { id: 'c1', parentId: null, isThread: () => false, isSendable: () => false };
  const guild = { id: '77', vanityURLCode: null, members: { me: { permissions: { has: () => false } } }, channels: { cache: new Map() } };
  const coll = (n = 0) => ({ size: n, filter: () => ({ size: 0 }) });
  const message = {
    id: 'm1', guild, channel, content: 'join discord.gg/other', webhookId: null, system: false,
    author: { id: '5', bot: false, tag: 'u#1' },
    member: { roles: { cache: roles }, permissions: { any: () => false } },
    attachments: coll(), stickers: coll(), mentions: { users: coll(), roles: coll(), everyone: false, repliedUser: null },
    delete: async () => done.push('delete')
  };
  const ctx = {
    store, t: i18n.t, embeds,
    permissions: { isWhitelisted: () => false, botCan: () => true, canModerate: () => true },
    modlog: { send: async (g, cat, e) => logs.push(e) },
    logger: { warn() {}, error() {}, info() {}, debug() {} },
    client: { user: { id: '999' } }
  };
  await handler.handleMessage(ctx, message);
  assert.deepEqual(done, ['delete']);
  assert.equal(gs.get(`${C.STRIKES}.5`).length, 1);
  assert.equal(logs.length, 1);

  // Exempt channel: nothing happens.
  gs.set(C.GLOBAL.exemptChannels.path, ['c1']);
  await handler.handleMessage(ctx, { ...message, id: 'm2', author: { id: '6', bot: false, tag: 'v#1' } });
  assert.deepEqual(done, ['delete']);
  assert.ok(handler.isExempt(ctx, message, C.getConfig(gs)));
  assert.deepEqual(handler.channelScope({ id: 't', parentId: 'c', isThread: () => true, parent: { parentId: 'cat' } }), ['t', 'c', 'cat']);
});
