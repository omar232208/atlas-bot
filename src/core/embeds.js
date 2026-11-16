'use strict';

const { EmbedBuilder } = require('discord.js');
const store = require('./store');

/*
 * Atlas Embed Manager — the single design system for every bot embed.
 *
 * Kinds carry the semantic colour; the mark in the title carries the status.
 *   info      → Atlas electric blue
 *   success   → green
 *   error     → red
 *   warn      → orange (caution / moderation alerts)
 *   log       → slate blue (audit trails)
 *
 * Guilds can restyle every embed from the dashboard (Embeds module): accent
 * and per-kind colours, footer, author, branding and timestamp visibility.
 * Customisation is applied at send time by core/plain.js, so call sites keep
 * building embeds exactly as before.
 */

const ACCENT = 0x3b82f6;
const COLORS = {
  info: ACCENT,
  success: 0x3ba55d,
  error: 0xed4245,
  warn: 0xf0a03c,
  log: 0x5865f2
};
const MARKS = { success: '✓', error: '✕', warn: '!', info: '', log: '' };

// EmbedBuilder instance → kind, so the send pipeline can pick the right
// per-kind guild colour without changing any call site.
const KINDS = new WeakMap();
const kindOf = (embed) => {
  if (!embed || typeof embed !== 'object') return null;
  return KINDS.get(embed) || KINDS.get(embed.data) || null;
};

/**
 * Per-guild embed customisation stored by the Embeds dashboard module.
 * Returns null when the guild never customised anything (defaults apply).
 * @param {string} guildId
 */
function guildConfig(guildId) {
  if (!guildId || !/^\d+$/.test(String(guildId))) return null;
  try {
    const cfg = store.guild(guildId).get('embeds', null);
    return cfg && typeof cfg === 'object' ? cfg : null;
  } catch {
    return null;
  }
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const hex = (v) => (typeof v === 'string' && HEX_RE.test(v) ? parseInt(v.replace('#', ''), 16) : null);
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Applies guild customisation to one serialised embed (APIEmbed shape).
 * Kind colours win over the global accent; an existing footer is only
 * replaced when the guild set an explicit footer text.
 * @param {object} data APIEmbed data
 * @param {string} guildId
 * @param {string} kind
 * @returns {object} new APIEmbed data
 */
function style(data, guildId, kind = null) {
  const d = { ...data };
  const cfg = guildConfig(guildId);
  // Embeds built outside the manager (custom colours, e.g. suggestion
  // statuses) keep their colour unless the guild explicitly overrides it.
  const known = kind !== null;
  if (!cfg) {
    if (known) d.color = COLORS[kind] ?? ACCENT;
    return d;
  }

  if (known) {
    const kindColor = hex(cfg[`color${kind[0].toUpperCase()}${kind.slice(1)}`]) || hex(cfg.colors?.[kind]);
    const accent = hex(cfg.accentColor) || hex(cfg.color);
    d.color = kindColor || accent || COLORS[kind] || ACCENT;
  } else {
    const accent = hex(cfg.accentColor) || hex(cfg.color);
    const kindColor = accent; // unknown kind: only a global accent may override
    if (kindColor) d.color = kindColor;
  }

  const footerText = str(cfg.footerText, 2048);
  const showBranding = cfg.showBranding !== false;
  if (footerText) {
    d.footer = { ...(d.footer || {}), text: footerText };
    const icon = str(cfg.footerIcon, 1024);
    if (icon) d.footer.icon_url = icon;
  } else if (showBranding && !d.footer?.text) {
    d.footer = { text: 'Atlas' };
  }

  const authorName = str(cfg.authorName, 256);
  if (authorName) {
    d.author = { name: authorName };
    const icon = str(cfg.authorIcon, 1024);
    if (icon) d.author.icon_url = icon;
    if (str(cfg.authorUrl, 1024)) d.author.url = str(cfg.authorUrl, 1024);
  }

  if (cfg.showTimestamp === false) delete d.timestamp;
  return d;
}

/**
 * Builds the shared base embed.
 * @param {{title?: string, description?: string, fields?: Array<{name: string, value: string, inline?: boolean}>, footer?: string, timestamp?: boolean, kind?: string, color?: number}} [opts]
 * @returns {EmbedBuilder}
 */
function base(opts = {}) {
  const kind = opts.kind || 'info';
  const embed = new EmbedBuilder().setColor(opts.color ?? COLORS[kind] ?? ACCENT);
  if (opts.title) embed.setTitle(opts.title.slice(0, 256));
  if (opts.description) embed.setDescription(opts.description.slice(0, 4096));
  if (opts.fields?.length) embed.addFields(opts.fields.slice(0, 25).map((f) => ({ name: String(f.name).slice(0, 256), value: String(f.value || '-').slice(0, 1024), inline: !!f.inline })));
  if (opts.footer) embed.setFooter({ text: opts.footer.slice(0, 2048) });
  if (opts.timestamp) embed.setTimestamp();
  KINDS.set(embed, kind);
  return embed;
}

const withMark = (kind) => (title, description, opts = {}) => {
  const mark = MARKS[kind];
  return base({ ...opts, kind, title: title ? (mark ? `${mark} ${title}` : title) : undefined, description });
};

/**
 * Moderation action embed: action, target, moderator, reason, duration.
 * @param {{action: string, target: string, moderator?: string, reason?: string, duration?: string, fields?: Array, footer?: string, timestamp?: boolean}} opts
 */
function moderation(opts) {
  const fields = [];
  if (opts.target) fields.push({ name: 'Member', value: opts.target, inline: true });
  if (opts.moderator) fields.push({ name: 'Moderator', value: opts.moderator, inline: true });
  if (opts.duration) fields.push({ name: 'Duration', value: opts.duration, inline: true });
  if (opts.reason) fields.push({ name: 'Reason', value: opts.reason });
  fields.push(...(opts.fields || []));
  return base({ kind: 'warn', title: opts.action, fields, footer: opts.footer, timestamp: opts.timestamp !== false });
}

/**
 * Logging / audit embed: event type, actor, details.
 * @param {{title: string, actor?: string, fields?: Array, footer?: string}} opts
 */
function log(opts) {
  const fields = [];
  if (opts.actor) fields.push({ name: 'User', value: opts.actor, inline: true });
  fields.push(...(opts.fields || []));
  return base({ kind: 'log', title: opts.title, description: opts.description, fields, footer: opts.footer, timestamp: true });
}

/**
 * Giveaway embed: prize, host, winners, end time.
 * @param {{prize: string, host?: string, winners?: number|string, endsAt?: string|Date, fields?: Array, footer?: string}} opts
 */
function giveaway(opts) {
  const fields = [];
  if (opts.host) fields.push({ name: 'Hosted by', value: opts.host, inline: true });
  if (opts.winners !== undefined) fields.push({ name: 'Winners', value: String(opts.winners), inline: true });
  if (opts.endsAt) fields.push({ name: 'Ends', value: String(opts.endsAt), inline: true });
  fields.push(...(opts.fields || []));
  return base({ kind: 'info', title: opts.prize, description: opts.description, fields, footer: opts.footer, timestamp: true });
}

/**
 * Ticket embed: number, creator, status.
 * @param {{title: string, creator?: string, status?: string, fields?: Array, footer?: string}} opts
 */
function ticket(opts) {
  const fields = [];
  if (opts.creator) fields.push({ name: 'Opened by', value: opts.creator, inline: true });
  if (opts.status) fields.push({ name: 'Status', value: opts.status, inline: true });
  fields.push(...(opts.fields || []));
  return base({ kind: 'info', title: opts.title, description: opts.description, fields, footer: opts.footer, timestamp: true });
}

module.exports = {
  ACCENT,
  COLORS,
  base,
  style,
  kindOf,
  guildConfig,
  /** @type {(title: string, description?: string, opts?: object) => EmbedBuilder} */
  success: withMark('success'),
  /** @type {(title: string, description?: string, opts?: object) => EmbedBuilder} */
  error: withMark('error'),
  /** @type {(title: string, description?: string, opts?: object) => EmbedBuilder} */
  warn: withMark('warn'),
  /** @type {(title: string, description?: string, opts?: object) => EmbedBuilder} */
  info: withMark('info'),
  moderation,
  log,
  giveaway,
  ticket
};
