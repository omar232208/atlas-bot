'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../src/core/store');
const i18n = require('../src/core/i18n');
const { buildCommandJSON } = require('../src/core/registry');
const economy = require('../src/modules/economy/index.js');
const rules = require('../src/modules/economy/lib/rules');
const games = require('../src/modules/economy/lib/games');
const bj = require('../src/modules/economy/lib/blackjack');
const { normalize, getAccount, updateAccount } = require('../src/modules/economy/lib/accounts');
const { DEFAULTS, LIMITS, getConfig, formatMoney, currencyName } = require('../src/modules/economy/lib/config');
const { slugify } = require('../src/modules/economy/commands/shop');

const MODULE_DIR = path.join(__dirname, '..', 'src', 'modules', 'economy');
const LOCALES = path.join(__dirname, '..', 'locales');
const LANGS = ['ar', 'en'];

/** Scripted rng: returns the values in order, then repeats them. */
const seq = (values) => { let i = 0; return () => values[i++ % values.length]; };
const card = (rank, suit = '♠') => ({ rank, suit });
const tempStore = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-eco-')), debounceMs: 0 });

// ---------- rules ----------

test('parseAmount accepts digits and "all", rejects everything else', () => {
  assert.equal(rules.parseAmount('100', 1000), 100);
  assert.equal(rules.parseAmount(' 1_000 ', 5000), 1000);
  assert.equal(rules.parseAmount('ALL', 250), 250);
  assert.equal(rules.parseAmount('all', 0), 0);
  for (const bad of ['0', '-5', '1.5', 'abc', '', undefined, '9999999999999999999999']) {
    assert.equal(rules.parseAmount(bad, 100), null, `expected null for ${bad}`);
  }
});

test('cooldownLeft counts down and never goes negative', () => {
  assert.equal(rules.cooldownLeft(0, 500, 1000), 0);
  assert.equal(rules.cooldownLeft(1000, 500, 1200), 300);
  assert.equal(rules.cooldownLeft(1000, 500, 2000), 0);
});

test('dailyStatus: cooldown, streak continues within 48 h and resets after', () => {
  const day = rules.DAY;
  assert.deepEqual(rules.dailyStatus({ last: 0, streak: 0 }, 5 * day), { ready: true, streak: 1 });
  const soon = rules.dailyStatus({ last: 10 * day, streak: 2 }, 10 * day + 60 * 60 * 1000);
  assert.equal(soon.ready, false);
  assert.equal(soon.wait, day - 60 * 60 * 1000);
  assert.deepEqual(rules.dailyStatus({ last: 10 * day, streak: 3 }, 11 * day + 60 * 1000), { ready: true, streak: 4 });
  assert.deepEqual(rules.dailyStatus({ last: 10 * day, streak: 3 }, 13 * day), { ready: true, streak: 1 });
});

test('dailyReward adds 10 % per streak day, capped at +60 %', () => {
  assert.equal(rules.dailyReward(500, 1), 500);
  assert.equal(rules.dailyReward(500, 2), 550);
  assert.equal(rules.dailyReward(500, 7), 800);
  assert.equal(rules.dailyReward(500, 100), 800);
});

test('workReward stays within min..max, inclusive, and tolerates swapped bounds', () => {
  assert.equal(rules.workReward(50, 200, seq([0])), 50);
  assert.equal(rules.workReward(50, 200, seq([0.9999999])), 200);
  assert.equal(rules.workReward(200, 50, seq([0])), 50);
});

test('robOutcome: a failed attempt fines the robber, a success takes a share of the victim', () => {
  const fail = rules.robOutcome({ robberWallet: 1000, targetWallet: 500, failPercent: 50, rng: seq([0.1]) });
  assert.deepEqual(fail, { success: false, amount: 100 });
  // First draw passes the fail check (0.9 >= 50 %), second draw picks a 10 % share.
  const win = rules.robOutcome({ robberWallet: 1000, targetWallet: 1000, failPercent: 50, rng: seq([0.9, 0]) });
  assert.deepEqual(win, { success: true, amount: 100 });
  const tiny = rules.robOutcome({ robberWallet: 1000, targetWallet: 1, failPercent: 0, rng: seq([0.99, 0.99]) });
  assert.deepEqual(tiny, { success: true, amount: 1 });
});

// ---------- games ----------

test('slotsResult: triple pays its multiplier, pair returns the stake, otherwise nothing', () => {
  assert.deepEqual(games.slotsResult([0, 0, 0]), { multiplier: 100, kind: 'triple' });
  assert.deepEqual(games.slotsResult([1, 1, 1]), { multiplier: 40, kind: 'triple' });
  assert.deepEqual(games.slotsResult([0, 0, 3]), { multiplier: 1, kind: 'pair' });
  assert.deepEqual(games.slotsResult([3, 0, 0]), { multiplier: 1, kind: 'pair' });
  assert.deepEqual(games.slotsResult([0, 1, 2]), { multiplier: 0, kind: 'none' });
});

test('spinSlots draws reels with the declared weights', () => {
  const counts = new Array(games.SLOT_SYMBOLS.length).fill(0);
  for (let k = 0; k < games.TOTAL_WEIGHT; k++) {
    // Each point of the weight range maps to exactly one symbol.
    const [a, b, c] = games.spinSlots(() => (k + 0.5) / games.TOTAL_WEIGHT);
    assert.equal(a, b);
    assert.equal(b, c);
    counts[a]++;
  }
  games.SLOT_SYMBOLS.forEach((symbol, i) => assert.equal(counts[i], symbol.weight, symbol.symbol));
});

test('slots expected return is about 91 % (exact enumeration of all reel combinations)', () => {
  let expected = 0;
  const W = games.TOTAL_WEIGHT;
  for (let a = 0; a < games.SLOT_SYMBOLS.length; a++) {
    for (let b = 0; b < games.SLOT_SYMBOLS.length; b++) {
      for (let c = 0; c < games.SLOT_SYMBOLS.length; c++) {
        const p = games.SLOT_SYMBOLS[a].weight * games.SLOT_SYMBOLS[b].weight * games.SLOT_SYMBOLS[c].weight;
        expected += p * games.slotsResult([a, b, c]).multiplier;
      }
    }
  }
  const rtp = expected / (W * W * W);
  assert.ok(rtp > 0.85 && rtp < 0.97, `return to player ${rtp.toFixed(3)} out of range`);
});

test('coinflip: the pick wins only when the coin matches it', () => {
  assert.deepEqual(games.coinflip(seq([0.1]), 'heads'), { result: 'heads', won: true });
  assert.deepEqual(games.coinflip(seq([0.1]), 'tails'), { result: 'heads', won: false });
  assert.deepEqual(games.coinflip(seq([0.9]), 'tails'), { result: 'tails', won: true });
});

// ---------- blackjack ----------

test('handValue counts aces as 11 only when it does not bust', () => {
  assert.deepEqual(bj.handValue([card('A'), card('K')]), { total: 21, soft: true });
  assert.deepEqual(bj.handValue([card('A'), card('A'), card('9')]), { total: 21, soft: true });
  assert.deepEqual(bj.handValue([card('K'), card('Q'), card('5')]), { total: 25, soft: false });
  assert.deepEqual(bj.handValue([card('A'), card('5'), card('K')]), { total: 16, soft: false });
});

test('isNatural means exactly two cards totalling 21', () => {
  assert.equal(bj.isNatural([card('A'), card('J')]), true);
  assert.equal(bj.isNatural([card('A'), card('K'), card('K')]), false);
  assert.equal(bj.isNatural([card('7'), card('7'), card('7')]), false);
});

test('shuffle keeps all 52 distinct cards', () => {
  const deck = bj.shuffle(bj.buildDeck(), Math.random);
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.rank + c.suit)).size, 52);
});

test('newGame always deals two cards each and ends at once on a natural', () => {
  for (let i = 0; i < 300; i++) {
    const g = bj.newGame({ rng: Math.random });
    assert.equal(g.player.length, 2);
    assert.equal(g.dealer.length, 2);
    assert.equal(g.deck.length + 4, 52);
    const natural = bj.isNatural(g.player) || bj.isNatural(g.dealer);
    assert.equal(g.status === 'over', natural);
  }
});

test('hit: reaching 21 stands automatically, busting ends the hand, otherwise the turn continues', () => {
  const base = { deck: [card('6'), card('K')], dealer: [card('10'), card('7')], doubled: false, status: 'player' };
  const twentyOne = bj.hit({ ...base, player: [card('10'), card('5')] });
  assert.equal(twentyOne.status, 'over');
  assert.equal(bj.settle(twentyOne, 100).outcome, 'win');

  const bust = bj.hit({ ...base, deck: [card('K')], player: [card('10'), card('6')] });
  assert.equal(bust.status, 'over');
  assert.equal(bj.settle(bust, 100).outcome, 'bust');
  assert.deepEqual(bust.dealer, base.dealer, 'dealer does not draw after a bust');

  const more = bj.hit({ ...base, deck: [card('2'), card('K')], player: [card('10'), card('6')] });
  assert.equal(more.status, 'player');
  assert.equal(more.player.length, 3);
});

test('stand: the dealer draws to 17 or more, then the higher total wins', () => {
  const g = bj.stand({
    deck: [card('3'), card('4'), card('9')],
    player: [card('10'), card('K')],
    dealer: [card('10'), card('2')],
    doubled: false,
    status: 'player'
  });
  assert.equal(g.status, 'over');
  assert.equal(bj.handValue(g.dealer).total, 19);
  assert.equal(bj.settle(g, 100).outcome, 'win');
});

test('stand: dealer busting pays the player, a tie pushes, a lower total loses', () => {
  const dealerBust = bj.stand({ deck: [card('K')], player: [card('10'), card('9')], dealer: [card('10'), card('6')], doubled: false, status: 'player' });
  assert.deepEqual(bj.settle(dealerBust, 100), { outcome: 'win', payout: 200, net: 100 });
  const tie = bj.stand({ deck: [], player: [card('10'), card('8')], dealer: [card('10'), card('8')], doubled: false, status: 'player' });
  assert.deepEqual(bj.settle(tie, 100), { outcome: 'push', payout: 100, net: 0 });
  const lose = bj.stand({ deck: [], player: [card('10'), card('6')], dealer: [card('10'), card('8')], doubled: false, status: 'player' });
  assert.deepEqual(bj.settle(lose, 100), { outcome: 'lose', payout: 0, net: -100 });
});

test('doubleDown: one card, double stake, then the dealer plays', () => {
  const g = bj.doubleDown({ deck: [card('10'), card('2')], player: [card('5'), card('6')], dealer: [card('10'), card('7')], doubled: false, status: 'player' });
  assert.equal(g.doubled, true);
  assert.equal(g.player.length, 3);
  assert.equal(g.status, 'over');
  assert.deepEqual(bj.settle(g, 100), { outcome: 'win', payout: 400, net: 200 });
  assert.equal(bj.canDouble({ status: 'player', player: [card('5'), card('6')] }), true);
  assert.throws(() => bj.doubleDown({ deck: [card('2')], player: [card('5'), card('6'), card('2')], dealer: [], doubled: false, status: 'player' }));
});

test('settle: blackjack pays 3 to 2, and a dealer natural beats a non-natural hand', () => {
  const natural = { deck: [], player: [card('A'), card('K')], dealer: [card('9'), card('8')], doubled: false, status: 'over' };
  assert.deepEqual(bj.settle(natural, 100), { outcome: 'blackjack', payout: 250, net: 150 });
  const dealerNatural = { deck: [], player: [card('10'), card('9')], dealer: [card('A'), card('K')], doubled: false, status: 'over' };
  assert.deepEqual(bj.settle(dealerNatural, 100), { outcome: 'lose', payout: 0, net: -100 });
  const bothNatural = { deck: [], player: [card('A'), card('K')], dealer: [card('A'), card('Q')], doubled: false, status: 'over' };
  assert.deepEqual(bj.settle(bothNatural, 100), { outcome: 'push', payout: 100, net: 0 });
  assert.throws(() => bj.settle({ ...natural, status: 'player' }, 100));
});

// ---------- accounts and persistence ----------

test('normalize fills in missing or invalid fields', () => {
  const acc = normalize({ wallet: 'lots', bank: 40, daily: { last: 9 } });
  assert.deepEqual(acc, { wallet: 0, bank: 40, daily: { last: 9, streak: 0 }, weekly: 0, work: 0, rob: 0, inventory: {} });
  assert.deepEqual(normalize(undefined).inventory, {});
});

test('updateAccount persists balance changes and returns the callback value', () => {
  const s = tempStore();
  const result = updateAccount(s, '111', '222', (acc) => { acc.wallet += 75; return 'ok'; });
  assert.equal(result, 'ok');
  assert.equal(getAccount(s, '111', '222').wallet, 75);
  assert.equal(s.guild('111').get('economy.users.222.wallet'), 75);
});

// ---------- config and formatting ----------

test('getConfig merges stored values over defaults and ignores null', () => {
  const s = tempStore();
  assert.deepEqual(getConfig(s, '333'), DEFAULTS);
  s.guild('333').set('economy.config', { daily: 900, symbol: null, currency: 'gold' });
  const cfg = getConfig(s, '333');
  assert.equal(cfg.daily, 900);
  assert.equal(cfg.symbol, DEFAULTS.symbol);
  assert.equal(cfg.currency, 'gold');
});

test('formatMoney and currencyName use the language and defaults', () => {
  assert.equal(formatMoney(1250, { ...DEFAULTS, symbol: '€' }, 'en'), '1,250 €');
  assert.equal(currencyName(DEFAULTS, 'en'), i18n.t('en', 'economy:defaults.currency'));
  assert.equal(currencyName({ ...DEFAULTS, currency: 'gold' }, 'en'), 'gold');
});

test('shop ids: slugify makes lowercase ascii dashes and refuses empty names', () => {
  assert.equal(slugify('Pizza Géante !'), 'pizza-geante');
  assert.equal(slugify('!!!'), '');
  assert.ok(slugify('x'.repeat(60)).length <= 24);
});

// ---------- dashboard schema ----------

test('dashboard: every field path is read by the code (a stored value changes the config)', () => {
  const schema = economy.dashboard.sections[0];
  assert.equal(schema.id, 'general');
  assert.ok(schema.fields.length >= 7);
  const s = tempStore();
  for (const field of schema.fields) {
    const key = field.path.replace(/^economy\.config\./, '');
    assert.match(field.path, /^economy\.config\.\w+$/);
    assert.ok(key in DEFAULTS, `${field.path} has no default in lib/config.js`);
    assert.deepEqual(field.default, DEFAULTS[key], `default of ${field.path} differs from the code`);
    const value = field.type === 'string'
      ? 'TEST'
      : (field.min + 1 === DEFAULTS[key] ? field.min + 2 : field.min + 1);
    s.guild('444').set(field.path, value);
    assert.equal(getConfig(s, '444')[key], value, `code does not read ${field.path}`);
  }
});

test('dashboard: numeric fields have bounds that match the limits used by the commands', () => {
  for (const field of economy.dashboard.sections[0].fields.filter((f) => f.type === 'number')) {
    const key = field.path.replace(/^economy\.config\./, '');
    assert.deepEqual([field.min, field.max], LIMITS[key]);
  }
});

// ---------- commands, locales and keys ----------

test('economy has 7 top-level commands and every name and option builds localized Discord JSON', () => {
  const names = new Set();
  const checkOptions = (json, options = json.options || []) => {
    for (const opt of options) {
      assert.ok(opt.description_localizations?.ar, `${json.name}/${opt.name} has no French description`);
      if (opt.options) checkOptions(json, opt.options);
    }
  };
  for (const cmd of economy.commands) {
    cmd.module = 'economy';
    const json = buildCommandJSON(cmd);
    assert.match(json.name, /^[-_a-z0-9]{1,32}$/);
    assert.ok(json.description_localizations?.ar, `${json.name} has no French description`);
    checkOptions(json);
    names.add(json.name);
  }
  assert.deepEqual([...names].sort(), ['balance', 'bank', 'eco', 'gamble', 'pay', 'shop', 'work']);
  const eco = economy.commands.find((c) => c.data.name === 'eco').data.toJSON();
  assert.deepEqual(eco.options.map((o) => o.name), ['daily', 'weekly', 'rob', 'inventory', 'richest', 'config']);
  const gamble = economy.commands.find((c) => c.data.name === 'gamble').data.toJSON();
  assert.deepEqual(gamble.options.map((o) => o.name), ['coinflip', 'slots', 'blackjack']);
});

/** Flattens a locale object into dotted keys. */
function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

test('locale files: the five languages have identical key sets', () => {
  const sets = LANGS.map((lang) => new Set(flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, lang, 'economy.json'), 'utf8')))));
  for (let i = 1; i < LANGS.length; i++) {
    assert.deepEqual([...sets[i]].sort(), [...sets[0]].sort(), `${LANGS[i]} differs from fr`);
  }
});

test('every translation key used in the source exists in all five languages', () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) sources.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(MODULE_DIR);
  const keys = new Set();
  for (const src of sources) for (const [, key] of src.matchAll(/'(economy:[A-Za-z0-9_.-]+)'/g)) keys.add(key);
  // economy:blackjack-timeout is a scheduler job type, not a translation key.
  keys.delete('economy:blackjack-timeout');
  assert.ok(keys.size > 40);
  for (const key of keys) for (const lang of LANGS) assert.ok(i18n.has(lang, key), `${lang} is missing ${key}`);
});

test('no single-quoted literal uses the economy. prefix except the known store paths', () => {
  const allowed = new Set(['economy.config', 'economy.users', 'economy.shop']);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      for (const [, lit] of fs.readFileSync(full, 'utf8').matchAll(/'(economy\.[A-Za-z0-9_.]+)'/g)) {
        // Dashboard schema paths (economy.config.<key>) are store paths too.
        if (/^economy\.config\.\w+$/.test(lit)) continue;
        assert.ok(allowed.has(lit), `${entry.name}: "${lit}" looks like a translation key without a colon`);
      }
    }
  };
  walk(MODULE_DIR);
});

test('groupCommand routes each subcommand to its own leaf and keeps the leaf options', async () => {
  const { groupCommand } = require('../src/modules/economy/lib/group');
  const { SlashCommandBuilder } = require('discord.js');
  const leaf = (name, result) => ({
    data: new SlashCommandBuilder().setName(name).setDescription(`${name} leaf`).addStringOption((o) => o.setName('amount').setDescription('x')),
    execute: async () => result
  });
  const group = groupCommand({ name: 'grp', description: 'group', leaves: [leaf('one', 1), leaf('two', 2)] });
  const json = group.data.toJSON();
  assert.deepEqual(json.options.map((o) => o.name), ['one', 'two']);
  assert.equal(json.options[1].options[0].name, 'amount');
  const fake = (sub) => ({ options: { getSubcommand: () => sub } });
  assert.equal(await group.execute(fake('two'), {}), 2);
  assert.equal(await group.execute(fake('one'), {}), 1);
});
