'use strict';

// "npm run check": static health check of the whole bot without connecting to
// Discord. Errors make the script exit with code 1; warnings are informative.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, 'locales');
const LANGUAGES = ['ar', 'en'];
const MAX_LINES = 400;
const COMMAND_LIMIT = 100;
const NAME_RE = /^[-_\p{L}\p{N}]{1,32}$/u;

/**
 * Flattens nested locale objects into "a.b.c" keys.
 * @param {object} obj
 * @param {string} [prefix]
 * @returns {string[]}
 */
function flattenKeys(obj, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(obj || {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...flattenKeys(value, full));
    else out.push(full);
  }
  return out;
}

/** Value at a dotted path of a plain object. */
const at = (obj, key) => key.split('.').reduce((cur, k) => (cur && typeof cur === 'object' ? cur[k] : undefined), obj);
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/**
 * Compares every namespace across the supported languages (ar, en).
 * @param {string} [dir]
 * @returns {{namespaces: string[], errors: string[], warnings: string[]}}
 */
function checkLocales(dir = LOCALES_DIR) {
  const errors = [];
  const warnings = [];
  const data = {};
  const namespaces = new Set();
  for (const lang of LANGUAGES) {
    data[lang] = {};
    const langDir = path.join(dir, lang);
    if (!fs.existsSync(langDir)) { errors.push(`locales/${lang} is missing`); continue; }
    for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
      const ns = file.slice(0, -5);
      namespaces.add(ns);
      try {
        data[lang][ns] = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
      } catch (err) {
        errors.push(`locales/${lang}/${file}: invalid JSON (${err.message})`);
      }
    }
  }
  for (const ns of [...namespaces].sort()) {
    const ref = LANGUAGES.find((l) => data[l][ns]);
    const refKeys = new Set(flattenKeys(data[ref][ns]));
    for (const lang of LANGUAGES) {
      if (!data[lang][ns]) { errors.push(`locales/${lang}/${ns}.json is missing`); continue; }
      const keys = new Set(flattenKeys(data[lang][ns]));
      const missing = [...refKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !refKeys.has(k));
      if (missing.length) errors.push(`${lang}/${ns}: ${missing.length} missing key(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
      if (extra.length) errors.push(`${lang}/${ns}: ${extra.length} extra key(s) not in ${ref}: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? '…' : ''}`);
      for (const key of refKeys) {
        if (!keys.has(key)) continue;
        const a = at(data[ref][ns], key);
        const b = at(data[lang][ns], key);
        if (typeof a === 'string' && typeof b === 'string' && placeholders(a) !== placeholders(b)) warnings.push(`${lang}/${ns}: placeholders differ from ${ref} at "${key}"`);
        if (typeof b === 'string' && !b.trim()) errors.push(`${lang}/${ns}: empty string at "${key}"`);
      }
    }
  }
  return { namespaces: [...namespaces].sort(), errors, warnings };
}

/**
 * Validates one command JSON against Discord limits.
 * @param {object} json
 * @returns {string[]} Problems found.
 */
function validateCommandJSON(json) {
  const problems = [];
  const where = `/${json.name}`;
  const checkDesc = (label, desc, locs) => {
    if (!desc || desc.length > 100) problems.push(`${where} ${label}: description must be 1-100 characters`);
    for (const [locale, text] of Object.entries(locs || {})) if (!text || text.length > 100) problems.push(`${where} ${label}: ${locale} description must be 1-100 characters`);
  };
  if (!NAME_RE.test(json.name) || json.name !== json.name.toLowerCase()) problems.push(`${where}: invalid name`);
  checkDesc('', json.description, json.description_localizations);
  const walk = (options, label) => {
    if ((options || []).length > 25) problems.push(`${where} ${label}: more than 25 options`);
    let seenOptional = false;
    for (const opt of options || []) {
      if (!NAME_RE.test(opt.name) || opt.name !== opt.name.toLowerCase()) problems.push(`${where} ${label}${opt.name}: invalid option name`);
      checkDesc(`${label}${opt.name}`, opt.description, opt.description_localizations);
      if (opt.type > 2) {
        if (opt.required && seenOptional) problems.push(`${where} ${label}${opt.name}: required option after an optional one`);
        if (!opt.required) seenOptional = true;
      }
      for (const choice of opt.choices || []) if (!choice.name || choice.name.length > 100) problems.push(`${where} ${label}${opt.name}: choice name must be 1-100 characters`);
      if (opt.options) walk(opt.options, `${label}${opt.name} `);
    }
  };
  walk(json.options, '');
  // Discord caps the combined text of a command (names, descriptions, choices) at 8000 characters per locale.
  const text = (o) => (o.name || '').length + (o.description || '').length + (o.choices || []).reduce((n, c) => n + c.name.length + String(c.value).length, 0) + (o.options || []).reduce((n, c) => n + text(c), 0);
  if (text(json) > 8000) problems.push(`${where}: more than 8000 characters of names and descriptions`);
  return problems;
}

/** Counts lines of the project's own JavaScript files. */
function lineCounts() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'data' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push({ file: path.relative(ROOT, full), lines: fs.readFileSync(full, 'utf8').split('\n').length });
    }
  };
  for (const dir of ['src', 'scripts', 'test']) if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
  files.push({ file: 'index.js', lines: fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8').split('\n').length });
  return files;
}

/** Runs every check and prints a report. Returns the number of errors. */
function main() {
  const errors = [];
  const warnings = [];
  const loader = require('../src/core/loader');
  const registry = require('../src/core/registry');
  const i18n = require('../src/core/i18n');

  // 1. Each module loads on its own (a broken one is reported by name).
  const folders = fs.readdirSync(loader.MODULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(loader.MODULES_DIR, d.name, 'index.js'))).map((d) => d.name).sort();
  for (const folder of folders) {
    try { require(path.join(loader.MODULES_DIR, folder, 'index.js')); } catch (err) { errors.push(`module ${folder}: ${err.message}`); }
  }
  // Strict mode also catches cross-module problems (duplicate command names or prefixes).
  try { loader.loadModules({ strict: true }); } catch (err) { if (!errors.length) errors.push(err.message); }
  const modules = loader.loadModules();
  console.log(`Modules: ${modules.length}/${folders.length} loaded (${modules.map((m) => m.name).join(', ')})`);

  // 2. Command JSON is valid and localized.
  let total = 0;
  for (const mod of modules) {
    for (const cmd of mod.commands) {
      total++;
      let json;
      try { json = registry.buildCommandJSON(cmd); } catch (err) { errors.push(`/${cmd.data.name}: toJSON failed (${err.message})`); continue; }
      errors.push(...validateCommandJSON(json));
      if (!i18n.has('en', `${mod.name}:commands.${json.name}.description`)) warnings.push(`/${json.name}: no English description (${mod.name}:commands.${json.name}.description)`);
    }
    for (const section of mod.dashboard?.sections || []) {
      for (const key of [section.title, ...section.fields.map((f) => f.label)]) if (key && key.includes(':') && !i18n.has('en', key)) warnings.push(`${mod.name} dashboard: missing English locale key ${key}`);
    }
  }
  console.log(`Commands: ${total} (Discord limit ${COMMAND_LIMIT})`);
  if (total > COMMAND_LIMIT) errors.push(`${total} commands: Discord accepts at most ${COMMAND_LIMIT}`);

  // 3. Locale parity for every namespace.
  const loc = checkLocales();
  errors.push(...loc.errors);
  warnings.push(...loc.warnings);
  console.log(`Locales: ${loc.namespaces.length} namespaces x ${LANGUAGES.length} languages`);
  for (const mod of modules) if (!loc.namespaces.includes(mod.name)) errors.push(`module ${mod.name}: no locales/<lang>/${mod.name}.json`);

  // 4. Line counts.
  const counts = lineCounts().sort((a, b) => b.lines - a.lines);
  const sum = counts.reduce((n, f) => n + f.lines, 0);
  console.log(`\nLines: ${sum} in ${counts.length} files. Largest:`);
  for (const f of counts.slice(0, 10)) console.log(`  ${String(f.lines).padStart(5)}  ${f.file}`);
  for (const f of counts) if (f.lines > MAX_LINES + 20) warnings.push(`${f.file}: ${f.lines} lines (aim for ${MAX_LINES} or less)`);
  const byModule = {};
  for (const f of counts) {
    const m = f.file.match(/^src[\\/]modules[\\/]([^\\/]+)/);
    const key = m ? m[1] : f.file.split(/[\\/]/)[0];
    byModule[key] = (byModule[key] || 0) + f.lines;
  }
  console.log('By module / folder:');
  for (const [k, v] of Object.entries(byModule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);

  if (warnings.length) { console.log(`\nWarnings (${warnings.length}):`); for (const w of warnings) console.log(`  - ${w}`); }
  if (errors.length) { console.log(`\nErrors (${errors.length}):`); for (const e of errors) console.log(`  - ${e}`); }
  console.log(errors.length ? '\nCheck FAILED' : '\nCheck passed');
  return errors.length;
}

if (require.main === module) process.exitCode = main() ? 1 : 0;

module.exports = { flattenKeys, checkLocales, validateCommandJSON, lineCounts, LANGUAGES };
