'use strict';

const { ApplicationCommandOptionType, PermissionsBitField } = require('discord.js');
const i18n = require('../../../core/i18n');

const NS = 'core-commands';
const LINES_PER_PAGE = 12;
const isSub = (type) => type === ApplicationCommandOptionType.Subcommand;
const isGroup = (type) => type === ApplicationCommandOptionType.SubcommandGroup;

/**
 * Translates a key, or returns `fallback` when no language has it (t() returns
 * the key itself in that case).
 */
function tOr(target, key, fallback, vars) {
  const value = i18n.t(target, key, vars);
  return value === key ? fallback : value;
}

/**
 * Localized display name and description of a module, from core-commands:modules.<name>.
 * A module dropped in without an entry there still shows its folder name.
 * @param {*} target Language target.
 * @param {string} name Module folder name.
 */
function moduleInfo(target, name) {
  return {
    name: tOr(target, `${NS}:modules.${name}.name`, name),
    description: tOr(target, `${NS}:modules.${name}.description`, '')
  };
}

/**
 * Formats a command path as a clickable mention when its id is known.
 * @param {string} path e.g. "config language"
 * @param {Map<string, string>} [ids] Command name → id.
 */
function mention(path, ids) {
  const id = ids?.get(path.split(' ')[0]);
  return id ? `</${path}:${id}>` : `\`/${path}\``;
}

/**
 * Flattens a command into one entry per runnable path (command, subcommand or
 * group + subcommand) with its localized description.
 * @param {*} target
 * @param {{data: object, module: string}} cmd
 * @returns {Array<{path: string, description: string, options: object[]}>}
 */
function commandEntries(target, cmd) {
  const json = cmd.data.toJSON();
  const base = `${cmd.module}:commands.${json.name}`;
  const entries = [];
  const subs = (json.options || []).filter((o) => isSub(o.type) || isGroup(o.type));
  if (!subs.length) {
    entries.push({ path: json.name, description: tOr(target, `${base}.description`, json.description), options: json.options || [], key: base });
    return entries;
  }
  for (const opt of subs) {
    const key = `${base}.options.${opt.name}`;
    if (isSub(opt.type)) {
      entries.push({ path: `${json.name} ${opt.name}`, description: tOr(target, `${key}.description`, opt.description), options: opt.options || [], key });
      continue;
    }
    for (const sub of opt.options || []) {
      const subKey = `${key}.options.${sub.name}`;
      entries.push({ path: `${json.name} ${opt.name} ${sub.name}`, description: tOr(target, `${subKey}.description`, sub.description), options: sub.options || [], key: subKey });
    }
  }
  return entries;
}

/**
 * Modules that expose at least one command, in folder order.
 * @param {Array<{name: string, commands: object[]}>} modules
 */
function modulesWithCommands(modules) {
  return modules.filter((m) => m.commands.length);
}

/**
 * Description pages of one module (LINES_PER_PAGE commands per page).
 * @param {*} target
 * @param {{name: string, commands: object[]}} mod
 * @param {Map<string, string>} [ids]
 * @returns {string[]}
 */
function modulePages(target, mod, ids) {
  const lines = mod.commands.flatMap((cmd) => commandEntries(target, cmd)).map((e) => `${mention(e.path, ids)} : ${e.description}`);
  const pages = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) pages.push(lines.slice(i, i + LINES_PER_PAGE).join('\n'));
  return pages.length ? pages : [''];
}

/**
 * Finds a command by name across modules.
 * @param {Array<{commands: object[]}>} modules
 * @param {string} name
 */
function findCommand(modules, name) {
  const wanted = String(name || '').replace(/^\//, '').split(' ')[0].toLowerCase();
  for (const mod of modules) {
    const cmd = mod.commands.find((c) => c.data.name === wanted);
    if (cmd) return cmd;
  }
  return null;
}

/**
 * Localized labels of the permissions a command requires by default.
 * @param {*} target
 * @param {object} cmd
 * @returns {string[]}
 */
function requiredPermissions(target, cmd) {
  const raw = cmd.data.toJSON().default_member_permissions;
  if (raw === null || raw === undefined || raw === '0') return [];
  const permissions = require('../../../core/permissions');
  return new PermissionsBitField(BigInt(raw)).toArray().map((p) => permissions.permissionLabel(target, p));
}

/**
 * Autocomplete choices for /help command: matches name or localized description.
 * @param {*} target
 * @param {Array<{commands: object[]}>} modules
 * @param {string} query
 */
function searchCommands(target, modules, query) {
  const q = String(query || '').toLowerCase();
  const out = [];
  for (const mod of modules) {
    for (const cmd of mod.commands) {
      const entry = commandEntries(target, cmd)[0];
      const desc = tOr(target, `${cmd.module}:commands.${cmd.data.name}.description`, cmd.data.description);
      if (q && !cmd.data.name.includes(q) && !desc.toLowerCase().includes(q) && !entry.path.includes(q)) continue;
      out.push({ name: `/${cmd.data.name} - ${desc}`.slice(0, 100), value: cmd.data.name });
    }
  }
  return out.slice(0, 25);
}

module.exports = { NS, LINES_PER_PAGE, tOr, moduleInfo, mention, commandEntries, modulesWithCommands, modulePages, findCommand, requiredPermissions, searchCommands };
