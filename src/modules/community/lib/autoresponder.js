'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { createCooldowns } = require('../../../core/cooldown');
const { setting, COLLECTIONS } = require('./config');
const { fill, memberVars, clip } = require('./util');

const MODES = ['exact', 'contains', 'startswith', 'word'];
const MAX_RULES = 50;
const cooldowns = createCooldowns();

/**
 * Lowercases, strips accents and collapses spaces so "Bonjour  !" matches "bonjour !".
 * @param {string} text
 */
const normalize = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a message matches a rule.
 * exact: whole message; contains: anywhere; startswith: beginning;
 * word: as a whole word/phrase (so "hi" does not fire on "this").
 * @param {string} content
 * @param {{trigger: string, mode: string}} rule
 */
function matches(content, rule) {
  const text = normalize(content);
  const trigger = normalize(rule.trigger);
  if (!text || !trigger) return false;
  switch (rule.mode) {
    case 'exact': return text === trigger;
    case 'startswith': return text.startsWith(trigger);
    case 'word': return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(trigger)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
    default: return text.includes(trigger);
  }
}

/**
 * First matching rule. Exact rules win over looser ones so a precise answer is
 * never shadowed by a generic "contains".
 * @param {string} content
 * @param {Array<object>} rules
 */
function findRule(content, rules) {
  const order = { exact: 0, word: 1, startswith: 2, contains: 3 };
  return [...(rules || [])].sort((a, b) => (order[a.mode] ?? 9) - (order[b.mode] ?? 9)).find((r) => matches(content, r)) || null;
}

/**
 * Message hook: replies with the matching auto-response.
 * Needs the Message Content intent; without it content is empty and nothing fires.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 */
async function onMessage(ctx, message) {
  const g = ctx.store.guild(message.guildId);
  if (!setting(g, 'community.autoresponder.enabled')) return;
  const rules = g.get(COLLECTIONS.responders, []);
  if (!rules.length || !message.content) return;
  const rule = findRule(message.content, rules);
  if (!rule) return;
  if (rule.channels?.length && !rule.channels.includes(message.channelId)) return;
  const cd = Math.max(0, Number(setting(g, 'community.autoresponder.cooldown')) || 0) * 1000;
  if (cd && cooldowns.hit(`${message.channelId}:${rule.id}`, cd) > 0) return;
  if (!ctx.permissions.botCan(message.guild, PermissionFlagsBits.SendMessages, message.channel)) return;
  const text = clip(fill(rule.response, memberVars(message.member || message.author, message.guild, message.channel)), 2000);
  // Auto-responses are conversation, not command replies: plain text, and never able to ping.
  await message.reply({ content: text, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
}

module.exports = { MODES, MAX_RULES, normalize, matches, findRule, onMessage };
