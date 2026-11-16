'use strict';

/*
 * Pure detection functions: they take plain text / plain objects and never
 * touch Discord, so every filter is unit-tested without a connection.
 */

// Common "leet speak" substitutions used to dodge word filters.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '€': 'e' };
const ZERO_WIDTH = /[​-‏⁠-⁤﻿­]/g;
// Combining marks used to build "zalgo" text. Restricted to the diacritic
// blocks so scripts that legitimately use marks (Hindi, Thai...) are not flagged.
const ZALGO_MARK = /[̀-ͯ҃-҉᪰-᫿᷀-᷿⃐-⃿︠-︯]/;
const CUSTOM_EMOJI = /<a?:\w{2,32}:\d{17,20}>/g;
const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;
const COMMON_TLDS = new Set(['com', 'net', 'org', 'io', 'gg', 'co', 'me', 'xyz', 'ru', 'tk', 'ly', 'be', 'fr', 'de', 'uk', 'info', 'biz', 'app', 'dev', 'site', 'online', 'shop', 'store', 'link', 'click', 'top', 'live', 'tv', 'cc', 'us', 'eu', 'es', 'it', 'pt', 'br', 'ch', 'ca', 'nl', 'pl', 'gift', 'ml', 'ga', 'cf', 'gq', 'su', 'cn', 'in']);
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}))(?::\d+)?(?:\/[^\s<>]*)?)/gi;
const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|discord\.io|dsc\.gg|invite\.gg)\/([a-z0-9-]{2,32})/gi;

/**
 * Lower-cases, removes accents, zero-width characters and leet substitutions,
 * so "B4D wörd" and "bad word" compare equal.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return String(text || '')
    .replace(ZERO_WIDTH, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134578@$!|€]/g, (c) => LEET[c] || c);
}

/**
 * Joins letters separated by single spacers ("b.a.d", "b a d" → "bad"), a
 * common trick to dodge word filters.
 * @param {string} text Already normalized.
 */
function collapseSpaced(text) {
  return text.replace(/(?<![\p{L}\p{N}])\p{L}(?:[\s._\-*~]\p{L}){2,}(?![\p{L}\p{N}])/gu, (m) => m.replace(/[\s._\-*~]/g, ''));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compiles a banned word pattern. "*" is a wildcard: "bad" matches the whole
 * word only, "bad*" words starting with bad, "*bad*" anywhere.
 * @param {string} pattern
 * @returns {RegExp|null}
 */
function compileWord(pattern) {
  const p = String(pattern || '').trim();
  if (!p || /^\*+$/.test(p)) return null;
  const parts = p.split('*').map((s) => escapeRe(normalizeText(s)));
  const body = parts.join('[^\\s]*');
  const left = p.startsWith('*') ? '' : '(?<![\\p{L}\\p{N}])';
  const right = p.endsWith('*') ? '' : '(?![\\p{L}\\p{N}])';
  return new RegExp(`${left}${body}${right}`, 'u');
}

/**
 * First banned word found in the text, or null.
 * @param {string} text
 * @param {string[]} words Patterns (see compileWord).
 * @returns {string|null} The matching pattern.
 */
function findBadWord(text, words) {
  if (!words?.length || !text) return null;
  const normal = normalizeText(text);
  const variants = [normal, collapseSpaced(normal)];
  for (const word of words) {
    const re = compileWord(word);
    if (re && variants.some((v) => re.test(v))) return word;
  }
  return null;
}

/**
 * Removes spaces around dots and slashes ("discord . gg / abc") before link
 * and invite detection, another common bypass.
 * @param {string} text
 */
function tighten(text) {
  return String(text || '').replace(ZERO_WIDTH, '').replace(/\s*([./])\s*/g, '$1');
}

/**
 * Invite codes found in the text (lowercase, unique).
 * @param {string} text
 * @returns {string[]}
 */
function findInvites(text) {
  const out = new Set();
  for (const m of tighten(text).matchAll(INVITE_RE)) out.add(m[1].toLowerCase());
  return [...out];
}

/**
 * Domains linked in the text. Without "http(s)://" or "www." only common
 * TLDs count, so "file.txt" or "v1.2" are not taken for links.
 * @param {string} text
 * @returns {string[]} Unique lowercase domains without "www.".
 */
function extractDomains(text) {
  const out = new Set();
  for (const m of String(text || '').replace(ZERO_WIDTH, '').matchAll(URL_RE)) {
    const full = m[1].toLowerCase();
    const explicit = full.startsWith('http://') || full.startsWith('https://') || full.startsWith('www.');
    if (!explicit && !COMMON_TLDS.has(m[3].toLowerCase())) continue;
    out.add(m[2].toLowerCase().replace(/^www\./, ''));
  }
  return [...out];
}

/**
 * Normalizes a domain typed by an admin ("https://www.Example.com/x" → "example.com").
 * @param {string} input
 * @returns {string|null} null when it is not a domain.
 */
function normalizeDomain(input) {
  const d = String(input || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d) ? d : null;
}

/**
 * Whether a domain is covered by a list entry (the entry itself or a subdomain of it).
 * @param {string} domain
 * @param {string[]} list
 */
function domainInList(domain, list) {
  return (list || []).some((d) => domain === d || domain.endsWith(`.${d}`));
}

/**
 * Domains that the links filter must block.
 * @param {string} text
 * @param {{mode: 'allowlist'|'denylist', allow: string[], deny: string[]}} links
 * @returns {string[]}
 */
function blockedDomains(text, links) {
  return extractDomains(text).filter((d) => {
    if (domainInList(d, links.deny)) return true;
    return links.mode !== 'denylist' && !domainInList(d, links.allow);
  });
}

/**
 * Upper-case share of the cased letters, ignoring mentions, emojis, links and code.
 * @param {string} text
 * @returns {{letters: number, ratio: number}}
 */
function capsStats(text) {
  const clean = String(text || '').replace(/```[\s\S]*?```|`[^`]*`/g, '').replace(/<[@#&!:a-z0-9]+>/gi, '').replace(URL_RE, '');
  const upper = (clean.match(/\p{Lu}/gu) || []).length;
  const lower = (clean.match(/\p{Ll}/gu) || []).length;
  const letters = upper + lower;
  return { letters, ratio: letters ? upper / letters : 0 };
}

/**
 * Longest run of stacked combining marks (zalgo).
 * @param {string} text
 */
function zalgoStack(text) {
  let max = 0;
  let run = 0;
  for (const ch of String(text || '')) {
    run = ZALGO_MARK.test(ch) ? run + 1 : 0;
    if (run > max) max = run;
  }
  return max;
}

/**
 * Number of emojis (custom and unicode).
 * @param {string} text
 */
function countEmojis(text) {
  const s = String(text || '');
  const custom = (s.match(CUSTOM_EMOJI) || []).length;
  return custom + (s.replace(CUSTOM_EMOJI, '').match(UNICODE_EMOJI) || []).length;
}

/**
 * Number of line breaks.
 * @param {string} text
 */
function countLines(text) {
  return (String(text || '').match(/\n/g) || []).length;
}

/**
 * Unique user and role mentions written in the text, plus @everyone/@here.
 * Used when the message's resolved mentions are not available (tests, edits).
 * @param {string} text
 */
function countMentionsInText(text) {
  const s = String(text || '');
  const users = new Set([...s.matchAll(/<@!?(\d{17,20})>/g)].map((m) => m[1]));
  const roles = new Set([...s.matchAll(/<@&(\d{17,20})>/g)].map((m) => m[1]));
  return users.size + roles.size + (/@(everyone|here)/.test(s) ? 1 : 0);
}

/**
 * Text used to compare messages for the duplicate filter.
 * @param {string} text
 * @returns {string} Empty when the message has no text.
 */
function fingerprint(text) {
  return normalizeText(text).replace(/\s+/g, ' ').trim();
}

/** Filters in the order they are checked: the first match decides. */
const FILTER_ORDER = ['badwords', 'invites', 'links', 'mentions', 'spam', 'duplicates', 'attachments', 'zalgo', 'caps', 'emojis', 'newlines'];

/**
 * Runs every enabled filter on a message.
 * @param {{content: string, mentions?: number, attachments?: number, ownInvites?: string[]}} input
 * @param {{filters: Record<string, object>, badwords: string[], links: object}} cfg See config.getConfig().
 * @param {{messages: number, duplicates: number, attachments: number}|null} stats From the spam tracker (null for edits).
 * @returns {Array<{filter: string, detail: object}>} Violations, most important first.
 */
function detect(input, cfg, stats) {
  const f = cfg.filters;
  const text = input.content || '';
  const out = [];
  const on = (name) => f[name]?.enabled;
  for (const name of FILTER_ORDER) {
    if (!on(name)) continue;
    let detail = null;
    if (name === 'badwords') { const word = findBadWord(text, cfg.badwords); if (word) detail = { word }; }
    if (name === 'invites') {
      const own = new Set(f.invites.allowOwn ? input.ownInvites || [] : []);
      const codes = findInvites(text).filter((c) => !own.has(c));
      if (codes.length) detail = { codes: codes.join(', ') };
    }
    if (name === 'links') { const domains = blockedDomains(text, cfg.links); if (domains.length) detail = { domains: domains.join(', ') }; }
    if (name === 'mentions') { const n = input.mentions ?? countMentionsInText(text); if (n >= f.mentions.limit) detail = { count: n }; }
    if (name === 'spam' && stats && stats.messages >= f.spam.limit) detail = { count: stats.messages, seconds: f.spam.seconds };
    if (name === 'duplicates' && stats && stats.duplicates >= f.duplicates.limit) detail = { count: stats.duplicates };
    if (name === 'attachments' && stats && stats.attachments >= f.attachments.limit) detail = { count: stats.attachments, seconds: f.attachments.seconds };
    if (name === 'zalgo') { const n = zalgoStack(text); if (n >= f.zalgo.limit) detail = { count: n }; }
    if (name === 'caps') { const c = capsStats(text); if (c.letters >= f.caps.minLength && c.ratio * 100 >= f.caps.percent) detail = { percent: Math.round(c.ratio * 100) }; }
    if (name === 'emojis') { const n = countEmojis(text); if (n >= f.emojis.limit) detail = { count: n }; }
    if (name === 'newlines') { const n = countLines(text); if (n >= f.newlines.limit) detail = { count: n }; }
    if (detail) out.push({ filter: name, detail });
  }
  return out;
}

module.exports = {
  FILTER_ORDER, normalizeText, collapseSpaced, compileWord, findBadWord, findInvites, extractDomains, normalizeDomain,
  domainInList, blockedDomains, capsStats, zalgoStack, countEmojis, countLines, countMentionsInText, fingerprint, detect
};
