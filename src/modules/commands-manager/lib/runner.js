'use strict';

const { MessageFlags } = require('discord.js');
const i18n = require('../../../core/i18n');
const permissions = require('../../../core/permissions');
const cooldowns = require('../../../core/cooldown');
const embeds = require('../../../core/embeds');
const { preflight, handleError } = require('../../../core/interactions');
const { getSubEnabledStorePath, getCommand } = require('../../../core/command-registry');

// ApplicationCommandOptionType values (discord.js v14).
const OPT = { SUB: 1, GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 };

const MENTION_RE = /<@!?\d{1,25}>|<@&\d{1,25}>|<#\d{1,25}>/g;
const NUMBER_RE = /-?\d+(?:\.\d+)?/;
const BOOL_RE = /\b(yes|no|true|false|on|off)\b/i;

/** Finds the loaded command object (data + execute) by slash name. */
function findCommand(ctx, name) {
  for (const mod of ctx.modules || []) {
    for (const cmd of mod.commands || []) {
      if (cmd?.data?.name === name) return cmd;
    }
  }
  return null;
}

/** Plain option list of a command or subcommand (toJSON when available). */
function optionList(cmdOrSub) {
  const data = typeof cmdOrSub.toJSON === 'function' ? cmdOrSub.toJSON() : cmdOrSub;
  return Array.isArray(data?.options) ? data.options : [];
}

/** Whole-word, case-insensitive search for an option/subcommand name in text. */
function wordIn(text, name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
}

/**
 * Picks the subcommand (and its option list) the message asks for. Returns
 * null when the command has subcommands but none is named in the text.
 */
function pickSubcommand(content, options) {
  const groups = options.filter((o) => o.type === OPT.GROUP);
  const subs = options.filter((o) => o.type === OPT.SUB);
  if (!groups.length && !subs.length) return { leaf: options.filter((o) => o.type >= OPT.STRING), sub: null, group: null };

  for (const g of groups) {
    if (!wordIn(content, g.name)) continue;
    const sub = optionList(g).find((s) => s.type === OPT.SUB && wordIn(content, s.name));
    if (sub) return { leaf: optionList(sub), sub, group: g.name };
    return null;
  }
  const sub = subs.find((s) => wordIn(content, s.name));
  if (sub) return { leaf: optionList(sub), sub, group: null };
  return null;
}

/** Removes the first occurrence of the trigger keyword from the text. */
function stripKeyword(text, keywords) {
  for (const kw of keywords || []) {
    if (typeof kw !== 'string' || !kw.trim()) continue;
    const idx = text.toLowerCase().indexOf(kw.toLowerCase());
    if (idx >= 0) return (text.slice(0, idx) + ' ' + text.slice(idx + kw.length)).replace(/\s+/g, ' ').trim();
  }
  return text;
}

/**
 * Resolves mentions in the message into per-option values. Strings and free
 * text are filled last so numbers/booleans can be picked out of the remainder.
 * Returns null when a required option cannot be satisfied.
 */
async function fillOptions(leaf, guild, message, leftover) {
  const values = {};
  const users = [...message.mentions.users.values()];
  const channels = [...message.mentions.channels.values()];
  const roles = [...message.mentions.roles.values()];
  let text = leftover;

  const takeNumber = () => {
    const m = text.match(NUMBER_RE);
    if (!m) return null;
    const raw = m[0];
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + raw.length)).replace(/\s+/g, ' ').trim();
    return Number(raw);
  };

  // Pass 1: everything that does not consume the free text.
  const deferred = [];
  for (const opt of leaf) {
    const name = opt.name;
    switch (opt.type) {
      case OPT.USER: {
        const u = users.shift();
        if (!u) { if (opt.required) return null; break; }
        const member = guild.members.cache.get(u.id) || (await guild.members.fetch(u.id).catch(() => null));
        values[name] = { kind: 'user', user: u, member };
        break;
      }
      case OPT.MENTIONABLE: {
        const u = users.shift();
        if (u) {
          const member = guild.members.cache.get(u.id) || (await guild.members.fetch(u.id).catch(() => null));
          values[name] = { kind: 'user', user: u, member };
        } else {
          const r = roles.shift();
          if (r) values[name] = { kind: 'role', role: r };
          else if (opt.required) return null;
        }
        break;
      }
      case OPT.CHANNEL: {
        const c = channels.shift();
        if (c) values[name] = { kind: 'channel', channel: c };
        else if (opt.required) return null;
        break;
      }
      case OPT.ROLE: {
        const r = roles.shift();
        if (r) values[name] = { kind: 'role', role: r };
        else if (opt.required) return null;
        break;
      }
      case OPT.ATTACHMENT: {
        const a = message.attachments.first();
        if (a) values[name] = { kind: 'attachment', attachment: a };
        else if (opt.required) return null;
        break;
      }
      case OPT.INTEGER:
      case OPT.NUMBER: {
        const n = takeNumber();
        if (n === null) { if (opt.required) return null; break; }
        values[name] = { kind: opt.type === OPT.INTEGER ? 'integer' : 'number', value: opt.type === OPT.INTEGER ? Math.trunc(n) : n };
        break;
      }
      case OPT.BOOLEAN: {
        const m = text.match(BOOL_RE);
        if (m) {
          values[name] = { kind: 'boolean', value: /^(yes|true|on)$/i.test(m[1]) };
          text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
        } else if (opt.required) return null;
        break;
      }
      default:
        deferred.push(opt); // STRING and anything unknown: handled in pass 2
    }
  }

  // Pass 2: string options get the remaining text (choices matched by name first).
  for (const opt of deferred) {
    if (opt.type !== OPT.STRING) continue;
    const choices = Array.isArray(opt.choices) ? opt.choices : [];
    if (choices.length) {
      const hit = choices.find((c) => wordIn(text, String(c.name)));
      if (hit) {
        values[opt.name] = { kind: 'string', value: hit.value };
        text = text.replace(new RegExp(`\\b${String(hit.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ').replace(/\s+/g, ' ').trim();
        continue;
      }
      if (opt.required) return null;
      continue;
    }
    if (text) {
      values[opt.name] = { kind: 'string', value: text.slice(0, opt.max_length || 2000) };
      text = '';
    } else if (opt.required) return null;
  }

  for (const opt of leaf) {
    if (opt.required && !values[opt.name]) return null;
  }
  return values;
}

/**
 * Minimal ChatInputCommandInteraction stand-in: replies go to the channel
 * (keyword triggers cannot be ephemeral), options come from the parsed message.
 */
function mockInteraction(ctx, message, name, sub, group, values) {
  const guild = message.guild;
  // Protection commands keep their embeds even when run by keyword.
  const keepEmbeds = getCommand(name)?.category === 'protection';
  let last = null;
  let replied = false;
  let deferred = false;

  const clean = (payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    const p = { ...payload };
    if (p.flags) p.flags = p.flags & ~MessageFlags.Ephemeral;
    delete p.withResponse;
    if (keepEmbeds) p._keepEmbeds = true;
    return p;
  };
  // discord.js returns { resource: { message } } when withResponse is set;
  // commands like /ping read response.resource.message for timing.
  const wrap = (wantsResource, msg) => (wantsResource ? { resource: { message: msg } } : msg);
  const send = async (payload) => {
    const wantsResource = !!(payload && typeof payload === 'object' && payload.withResponse);
    last = await message.channel.send(clean(payload));
    replied = true;
    return wrap(wantsResource, last);
  };
  const edit = async (payload) => {
    const wantsResource = !!(payload && typeof payload === 'object' && payload.withResponse);
    if (last) {
      last = await last.edit(clean(payload));
      replied = true;
      return wrap(wantsResource, last);
    }
    return send(payload);
  };

  const interaction = {
    client: ctx.client,
    guild,
    guildId: guild.id,
    channel: message.channel,
    channelId: message.channel.id,
    user: message.author,
    member: message.member,
    message,
    commandName: name,
    commandType: 1,
    createdTimestamp: Date.now(),
    id: `kw-${Date.now().toString(36)}`,
    token: 'keyword',
    locale: i18n.resolveLang(guild),
    guildLocale: i18n.resolveLang(guild),
    appPermissions: guild.members?.me?.permissions ?? null,
    memberPermissions: message.member?.permissions ?? null,
    inGuild: () => true,
    inCachedGuild: () => true,
    isRepliable: () => true,
    isChatInputCommand: () => true,
    isContextMenuCommand: () => false,
    isUserContextMenuCommand: () => false,
    isMessageContextMenuCommand: () => false,
    isMessageComponent: () => false,
    isButton: () => false,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,
    reply: async (p) => (deferred ? edit(p) : send(p)),
    followUp: send,
    editReply: edit,
    deferReply: async () => { deferred = true; },
    update: edit,
    deleteReply: async () => { if (last) await last.delete().catch(() => {}); },
    fetchReply: async () => last,
    showModal: async () => { throw new Error('keyword: modals are not supported'); },
    deferUpdate: async () => {},
    options: null
  };
  Object.defineProperty(interaction, 'replied', { get: () => replied });
  Object.defineProperty(interaction, 'deferred', { get: () => deferred });

  const entry = (v) => (v ? { name: v.kind === 'string' ? 'value' : 'resolved', value: v.kind === 'string' ? v.value : (v.user || v.member || v.channel || v.role || v.attachment || v.value), user: v.user, member: v.member, channel: v.channel, role: v.role, attachment: v.attachment } : null);
  const options = {
    data: Object.entries(values).map(([n, v]) => entry(v)),
    getSubcommand: (n) => (n === undefined ? (sub ? sub.name : null) : (sub && sub.name === n ? sub.name : null)),
    getSubcommandGroup: (n) => (group ? (n === undefined ? group : (group === n ? group : null)) : null),
    getUser: (n) => { const v = values[n]; return v && (v.kind === 'user') ? v.user : null; },
    getMember: (n) => { const v = values[n]; return v && (v.kind === 'user') ? v.member : null; },
    getChannel: (n) => { const v = values[n]; return v && v.kind === 'channel' ? v.channel : null; },
    getRole: (n) => { const v = values[n]; return v && v.kind === 'role' ? v.role : null; },
    getAttachment: (n) => { const v = values[n]; return v && v.kind === 'attachment' ? v.attachment : null; },
    getString: (n) => { const v = values[n]; return v && v.kind === 'string' ? v.value : null; },
    getInteger: (n) => { const v = values[n]; return v && v.kind === 'integer' ? v.value : null; },
    getNumber: (n) => { const v = values[n]; return v && v.kind === 'number' ? v.value : null; },
    getBoolean: (n) => { const v = values[n]; return v && v.kind === 'boolean' ? v.value : null; },
    getMentionable: (n) => {
      const v = values[n];
      if (!v) return null;
      if (v.kind === 'user') return v.member || v.user;
      if (v.kind === 'role') return v.role;
      return null;
    }
  };
  interaction.options = options;
  return interaction;
}

/**
 * Tries to run a command from a keyword message. Returns true when the command
 * was executed (or attempted); false when the message cannot fill its options,
 * so the caller can fall back to posting the slash-command mention.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 * @param {string} name Command name chosen by commandGuard.checkKeywords.
 */
async function tryKeywordRun(ctx, message, name) {
  const cmd = findCommand(ctx, name);
  if (!cmd || typeof cmd.execute !== 'function') return false;

  const guild = message.guild;
  const gs = ctx.store.guild(guild.id);

  // Respect per-subcommand switches the same way the slash router does: the
  // store key uses the first-level identifier (group name for grouped commands).
  const topOptions = optionList(cmd.data);
  const picked = pickSubcommand(message.content, topOptions);
  if (topOptions.some((o) => o.type === OPT.SUB || o.type === OPT.GROUP) && !picked) return false;
  if (picked?.sub) {
    const parent = gs.get(`commands.${name}.enabled`) ?? true;
    const subKey = picked.group || picked.sub.name;
    const subEnabled = gs.get(getSubEnabledStorePath(name, subKey), parent);
    if (!subEnabled) return false;
  }

  // Discord's own default_member_permissions still applies to keyword use.
  const dmp = cmd.data?.default_member_permissions ?? cmd.data?.toJSON?.().default_member_permissions;
  if (dmp && !message.member?.permissions?.has(BigInt(dmp))) {
    await message.channel.send({ embeds: [embeds.error(i18n.t(guild, 'common:errors.permissionTitle'), i18n.t(guild, 'common:errors.missingPermissionsUnknown'))] }).catch(() => {});
    return true;
  }

  const keywords = gs.get(`commands.${name}.keywords`) || [];
  const leftover = stripKeyword(message.content.replace(MENTION_RE, ' '), keywords).replace(/^[\s/]+/, '');
  const values = await fillOptions(picked ? picked.leaf : topOptions.filter((o) => o.type >= OPT.STRING), guild, message, leftover);
  if (!values) return false;

  if (cmd.cooldown && !permissions.isOwner(guild, message.author.id)) {
    const left = cooldowns.hit(`${name}:${message.author.id}`, cmd.cooldown * 1000);
    if (left > 0) return true; // Silently drop: the user just spammed the keyword.
  }

  const interaction = mockInteraction(ctx, message, name, picked?.sub || null, picked?.group || null, values);
  if (!(await preflight(interaction, cmd))) return true;
  try {
    await cmd.execute(interaction, ctx);
  } catch (err) {
    await handleError(interaction, err, cmd);
  }
  return true;
}

module.exports = { tryKeywordRun, findCommand, optionList, pickSubcommand, fillOptions, stripKeyword, OPT };
