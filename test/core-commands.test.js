'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aclbot-core-cmd-'));

const loader = require('../src/core/loader');
const { createContext } = require('../src/bot');
const core = require('../src/modules/core-commands');
const help = require('../src/modules/core-commands/commands/help');
const setup = require('../src/modules/core-commands/commands/setup');
const catalog = require('../src/modules/core-commands/lib/catalog');
const check = require('../scripts/check');

const modules = loader.loadModules();
const ctx = createContext(modules, null);
const fakeInteraction = (guildId = '100') => ({ guildId, user: { id: '5' } });

test('core-commands: exports the expected commands and components', () => {
  assert.equal(core.name, 'core-commands');
  assert.deepEqual(core.commands.map((c) => c.data.name), ['help', 'ping', 'botinfo', 'config', 'setup']);
  assert.deepEqual(core.components.map((c) => c.prefix), ['core:help:', 'core:setup:']);
  for (const cmd of core.commands) assert.doesNotThrow(() => cmd.data.toJSON());
});

test('help: overview lists modules in a select menu', () => {
  const payload = help.overview(ctx, 'ar');
  const json = payload.embeds[0].toJSON();
  assert.equal(json.title, 'المساعدة');
  assert.match(json.description, /عام/);
  const select = payload.components[0].toJSON().components[0];
  assert.equal(select.custom_id, 'core:help:mod');
  assert.ok(select.options.length >= 1 && select.options.length <= 25);
});

test('help: module page and pagination buttons', () => {
  const page = help.modulePage(ctx, 'en', 'core-commands', 0);
  const embed = page.embeds[0].toJSON();
  assert.match(embed.description, /`\/config language`/);
  const buttons = page.components[1].toJSON().components;
  assert.equal(buttons[1].disabled, true);
  // An unknown module falls back to the overview instead of failing.
  assert.equal(help.modulePage(ctx, 'en', 'nope').embeds[0].toJSON().title, 'Help');
});

test('help: command detail and search', () => {
  const cmd = catalog.findCommand(ctx.modules, '/config');
  const detail = help.commandDetail(ctx, 'en', cmd).embeds[0].toJSON();
  assert.match(detail.title, /\/config/);
  assert.ok(detail.fields.some((f) => /Manage Server/.test(f.value)));
  const found = catalog.searchCommands('ar', ctx.modules, 'سرعة');
  assert.ok(found.some((c) => c.value === 'ping'));
  assert.ok(catalog.searchCommands('en', ctx.modules, '').length <= 25);
});

test('catalog: subcommand entries and mentions', () => {
  const cmd = catalog.findCommand(ctx.modules, 'config');
  const entries = catalog.commandEntries('ar', cmd);
  assert.deepEqual(entries.map((e) => e.path), ['config language', 'config show', 'config reset']);
  assert.equal(catalog.mention('config show', new Map([['config', '99']])), '</config show:99>');
  assert.equal(catalog.mention('ping'), '`/ping`');
});

test('setup: every step renders, protections only for loaded modules', () => {
  const steps = setup.stepsFor(ctx);
  assert.equal(steps[0], 'language');
  assert.equal(steps.at(-1), 'done');
  for (const step of steps) {
    const payload = setup.render(ctx, fakeInteraction(), step);
    assert.ok(payload.embeds[0].toJSON().description.length > 0);
    for (const row of payload.components) assert.doesNotThrow(() => row.toJSON());
  }
});

test('dashboard schema: language field matches the store path i18n reads', () => {
  const field = core.dashboard.sections[0].fields[0];
  assert.equal(field.path, 'language');
  assert.deepEqual(field.options.map((o) => o.value), ['ar', 'en']);
});

test('dashboard reset action wipes guild settings', async () => {
  ctx.store.guild('321').set('language', 'ar');
  const key = await core.dashboard.actions[0].run(ctx, { id: '321' }, '5');
  assert.equal(ctx.store.guild('321').get('language', null), null);
  assert.ok(ctx.i18n.has('ar', key));
});

test('locales: common and core-commands have identical keys in 5 languages', () => {
  const result = check.checkLocales();
  const mine = result.errors.filter((e) => /\/(common|core-commands)[.:]/.test(e) || /(common|core-commands)\.json/.test(e));
  assert.deepEqual(mine, []);
});
