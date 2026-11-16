'use strict';

const TYPES = ['boolean', 'number', 'string', 'text', 'channel', 'role', 'channels', 'roles', 'select', 'list', 'duration'];
const SNOWFLAKE = /^\d{15,22}$/;
const DEFAULT_MAX_LENGTH = { string: 200, text: 4000, list: 200 };
const DEFAULT_MAX_ITEMS = { channels: 50, roles: 50, list: 200 };
// Store paths are dot paths of plain identifiers; anything else (prototype keys,
// empty segments) is refused so a schema typo can never write odd places.
const PATH_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

// Owner-only rules that hold even when a module forgets the `ownerOnly` flag:
// the bot whitelist (exempts from antinuke/automod), every antinuke and backup
// action (panic, snapshots) and the full settings reset mirror commands that
// are restricted to the server owner in Discord.
const OWNER_ONLY_PATHS = new Set(['whitelist']);
const OWNER_ONLY_ACTIONS = new Set(['antinuke/*', 'backup/*', 'core-commands/reset']);
const ownerOnlyAction = (mod, a) => !!a.ownerOnly || OWNER_ONLY_ACTIONS.has(`${mod}/*`) || OWNER_ONLY_ACTIONS.has(`${mod}/${a.id}`);

const validPath = (p) => typeof p === 'string' && PATH_RE.test(p) && !p.split('.').some((s) => FORBIDDEN_SEGMENTS.has(s));

/**
 * The module's on/off switch: the boolean field stored at "<module>.enabled".
 * Sub-feature switches (e.g. "utility.snipe.enabled") are not treated as the
 * module switch, otherwise a module would look "off" when only one feature is.
 * @param {string} name
 * @param {object[]} sections
 * @returns {string|null}
 */
function findToggle(name, sections) {
  const field = sections.flatMap((s) => s.fields).find((f) => f.type === 'boolean' && f.path === `${name}.enabled`);
  return field ? field.path : null;
}

/**
 * Normalises the `dashboard` exports of loaded modules. Invalid fields are dropped
 * (with a warning) so one bad schema cannot break the whole dashboard.
 * @param {Array<{name: string, dashboard?: object}>} modules
 * @param {{warn?: Function}} [logger]
 * @returns {Array<{name: string, sections: object[], actions: object[], toggle: string|null, fields: Map<string, object>}>}
 */
function collect(modules, logger) {
  const out = [];
  for (const mod of modules || []) {
    const dash = mod?.dashboard;
    if (!dash || !Array.isArray(dash.sections)) continue;
    const fields = new Map();
    const sections = [];
    for (const section of dash.sections) {
      if (!section || typeof section.id !== 'string') continue;
      const list = [];
      for (const f of section.fields || []) {
        if (!f || !TYPES.includes(f.type) || !validPath(f.path)) {
          logger?.warn?.(`dashboard: ignored invalid field in ${mod.name}/${section.id}:`, f?.path);
          continue;
        }
        if (fields.has(f.path)) continue;
        // Normalised copy: the flag is resolved once here so validation and the
        // public schema cannot disagree about who may change a field.
        const copy = { ...f, ownerOnly: !!(section.ownerOnly || f.ownerOnly || OWNER_ONLY_PATHS.has(f.path)) };
        fields.set(f.path, copy);
        list.push(copy);
      }
      if (list.length) sections.push({ ...section, fields: list });
    }
    const actions = (Array.isArray(dash.actions) ? dash.actions : []).filter((a) => a && typeof a.id === 'string' && /^[\w-]{1,64}$/.test(a.id) && typeof a.run === 'function')
      .map((a) => ({ ...a, ownerOnly: ownerOnlyAction(mod.name, a) }));
    if (!sections.length && !actions.length) continue;
    out.push({ name: mod.name, sections, actions, toggle: findToggle(mod.name, sections), fields });
  }
  return out;
}

/**
 * JSON-safe copy of a module schema for the browser (no functions).
 * Owner-only parts are flagged readOnly for everyone else; the server enforces
 * the same rule on writes, the flag only drives the UI.
 * @param {ReturnType<typeof collect>[number]} mod
 * @param {{isOwner?: boolean}} [viewer]
 */
function publicSchema(mod, viewer = {}) {
  const locked = (x) => !!x.ownerOnly && !viewer.isOwner;
  return {
    name: mod.name,
    toggle: mod.toggle,
    sections: mod.sections.map((s) => ({
      id: s.id,
      title: s.title || null,
      collapsible: !!s.collapsible,
      open: !!s.open,
      ownerOnly: s.fields.every((f) => f.ownerOnly),
      readOnly: s.fields.every(locked),
      description: s.description || null,
      fields: s.fields.map((f) => ({
        path: f.path,
        type: f.type,
        label: f.label || f.path,
        help: f.help || null,
        default: f.default === undefined ? null : f.default,
        min: f.min ?? null,
        max: f.max ?? null,
        maxLength: f.maxLength ?? null,
        ownerOnly: f.ownerOnly,
        readOnly: locked(f),
        channelTypes: Array.isArray(f.channelTypes) ? f.channelTypes : null,
        options: Array.isArray(f.options) ? f.options.map((o) => ({ value: o.value, label: o.label })) : null,
        group: typeof f.group === 'string' ? f.group : null
      }))
    })),
    actions: mod.actions.map((a) => ({ id: a.id, label: a.label || a.id, danger: !!a.danger, ownerOnly: a.ownerOnly, readOnly: locked(a) }))
  };
}

/**
 * Every i18n key a schema references (for /api/i18n).
 * @param {ReturnType<typeof collect>} mods
 * @returns {string[]}
 */
function labelKeys(mods) {
  const keys = new Set();
  const add = (k) => { if (typeof k === 'string' && k.includes(':')) keys.add(k); };
  for (const m of mods) {
    for (const s of m.sections) {
      add(s.title); add(s.description);
      for (const f of s.fields) {
        add(f.label); add(f.help);
        for (const o of f.options || []) add(o.label);
      }
    }
    for (const a of m.actions) add(a.label);
  }
  return [...keys];
}

const fail = (error, extra) => ({ ok: false, error, ...extra });
const okv = (value) => ({ ok: true, value });

function checkChannel(guild, field, id) {
  const ch = guild.channels?.cache?.get(id);
  if (!ch) return 'unknownChannel';
  if (Array.isArray(field.channelTypes) && field.channelTypes.length && !field.channelTypes.includes(ch.type)) return 'wrongChannelType';
  return null;
}

function checkRole(guild, id) {
  if (id === guild.id) return 'unknownRole';
  return guild.roles?.cache?.get(id) ? null : 'unknownRole';
}

function validateIds(field, value, guild, kind) {
  if (!Array.isArray(value)) return fail('type');
  const max = Number.isFinite(field.max) ? field.max : DEFAULT_MAX_ITEMS[field.type];
  const unique = [...new Set(value)];
  if (unique.length > max) return fail('tooMany', { max });
  for (const id of unique) {
    if (typeof id !== 'string' || !SNOWFLAKE.test(id)) return fail('type');
    const err = kind === 'channel' ? checkChannel(guild, field, id) : checkRole(guild, id);
    if (err) return fail(err);
  }
  if (Number.isFinite(field.min) && unique.length < field.min) return fail('tooFew', { min: field.min });
  return okv(unique);
}

/**
 * Validates (and normalises) one value against its schema field.
 * Channels and roles must exist in the guild, so the bot never stores an id it cannot use.
 * @param {object} field Schema field.
 * @param {*} value Value sent by the browser.
 * @param {{id: string, channels: {cache: Map}, roles: {cache: Map}}} guild
 * @returns {{ok: true, value: any} | {ok: false, error: string, min?: number, max?: number}}
 */
function validateValue(field, value, guild) {
  const nullable = field.default === null || field.type === 'channel' || field.type === 'role';
  if (value === null || value === undefined) return nullable ? okv(null) : fail('required');
  const min = Number.isFinite(field.min) ? field.min : null;
  const max = Number.isFinite(field.max) ? field.max : null;
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? okv(value) : fail('type');
    case 'number':
    case 'duration': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail('type');
      // Durations are stored in milliseconds, always whole numbers.
      const v = field.type === 'duration' ? Math.round(value) : value;
      if (field.type === 'duration' && v < 0) return fail('min', { min: 0 });
      if (min !== null && v < min) return fail('min', { min });
      if (max !== null && v > max) return fail('max', { max });
      return okv(v);
    }
    case 'string':
    case 'text': {
      if (typeof value !== 'string') return fail('type');
      const maxLength = field.maxLength || DEFAULT_MAX_LENGTH[field.type];
      const v = field.type === 'string' ? value.trim() : value.replace(/\r\n/g, '\n');
      if (v.length > maxLength) return fail('maxLength', { max: maxLength });
      if (min !== null && v.length < min) return fail('minLength', { min });
      return okv(v);
    }
    case 'select': {
      const options = Array.isArray(field.options) ? field.options : [];
      const match = options.find((o) => o.value === value);
      return match ? okv(match.value) : fail('option');
    }
    case 'channel': {
      if (value === '') return okv(null);
      if (typeof value !== 'string' || !SNOWFLAKE.test(value)) return fail('type');
      const err = checkChannel(guild, field, value);
      return err ? fail(err) : okv(value);
    }
    case 'role': {
      if (value === '') return okv(null);
      if (typeof value !== 'string' || !SNOWFLAKE.test(value)) return fail('type');
      const err = checkRole(guild, value);
      return err ? fail(err) : okv(value);
    }
    case 'channels':
      return validateIds(field, value, guild, 'channel');
    case 'roles':
      return validateIds(field, value, guild, 'role');
    case 'list': {
      if (!Array.isArray(value)) return fail('type');
      const maxLength = field.maxLength || DEFAULT_MAX_LENGTH.list;
      const items = [];
      for (const item of value) {
        if (typeof item !== 'string') return fail('type');
        const v = item.trim();
        if (!v) continue;
        if (v.length > maxLength) return fail('maxLength', { max: maxLength });
        if (!items.includes(v)) items.push(v);
      }
      const maxItems = max ?? DEFAULT_MAX_ITEMS.list;
      if (items.length > maxItems) return fail('tooMany', { max: maxItems });
      if (min !== null && items.length < min) return fail('tooFew', { min });
      return okv(items);
    }
    default:
      return fail('type');
  }
}

/**
 * Validates a whole patch { path: value } against the modules. Unknown paths are errors.
 * @param {ReturnType<typeof collect>} mods
 * @param {object} changes
 * @param {object} guild
 * @param {{isOwner?: boolean}} [viewer] Owner-only fields are refused for non-owners.
 * @returns {{ok: boolean, values: Array<{path: string, value: any, field: object, module: string}>, errors: Record<string, object>}}
 */
function validatePatch(mods, changes, guild, viewer = {}) {
  const errors = {};
  const values = [];
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { ok: false, values, errors: { _: { error: 'type' } } };
  const entries = Object.entries(changes);
  if (!entries.length || entries.length > 200) return { ok: false, values, errors: { _: { error: 'empty' } } };
  for (const [path, value] of entries) {
    const mod = mods.find((m) => m.fields.has(path));
    if (!mod) { errors[path] = { error: 'unknownField' }; continue; }
    const field = mod.fields.get(path);
    if (field.ownerOnly && !viewer.isOwner) { errors[path] = { error: 'ownerOnly' }; continue; }
    const res = validateValue(field, value, guild);
    if (res.ok) values.push({ path, value: res.value, field, module: mod.name });
    else errors[path] = { error: res.error, min: res.min, max: res.max };
  }
  return { ok: !Object.keys(errors).length, values, errors };
}

module.exports = { OWNER_ONLY_PATHS, OWNER_ONLY_ACTIONS, TYPES, collect, publicSchema, labelKeys, validateValue, validatePatch, findToggle, validPath };
