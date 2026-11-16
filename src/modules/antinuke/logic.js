'use strict';

const { AuditLogEvent, PermissionFlagsBits, ChannelType } = require('discord.js');

/**
 * Pure logic of the antinuke module: settings, per-action limits, audit entry
 * classification, permission maths and the snapshots used to restore deleted
 * channels and roles. No Discord calls here, so everything is unit-tested.
 */

// limit = actions allowed inside the window; one more triggers the protection.
// 0 means the very first action by an untrusted member is blocked.
const ACTION_DEFS = {
  channelDelete: { limit: 1, windowSec: 60 },
  channelCreate: { limit: 4, windowSec: 60 },
  roleDelete: { limit: 1, windowSec: 60 },
  roleCreate: { limit: 4, windowSec: 60 },
  rolePermGrant: { limit: 0, windowSec: 60 },
  memberRoleGrant: { limit: 0, windowSec: 60 },
  ban: { limit: 3, windowSec: 60 },
  kick: { limit: 3, windowSec: 60 },
  prune: { limit: 0, windowSec: 60 },
  webhookCreate: { limit: 2, windowSec: 60 },
  webhookSpam: { limit: 10, windowSec: 5 },
  guildUpdate: { limit: 2, windowSec: 300 },
  vanity: { limit: 0, windowSec: 60 },
  emojiDelete: { limit: 3, windowSec: 60 },
  stickerDelete: { limit: 2, windowSec: 60 }
};
const ACTIONS = Object.keys(ACTION_DEFS);
// Webhook spam counts messages, not admin actions: panic mode must not make a single webhook message fatal.
const PANIC_EXEMPT = new Set(['webhookSpam']);
const PUNISHMENTS = ['quarantine', 'strip', 'kick', 'ban', 'timeout'];

const SETTINGS = {
  enabled: { path: 'antinuke.enabled', default: false },
  punishment: { path: 'antinuke.punishment', default: 'strip', options: PUNISHMENTS },
  quarantineRoleId: { path: 'antinuke.quarantineRoleId', default: null, kind: 'id' },
  timeoutMinutes: { path: 'antinuke.timeoutMinutes', default: 1440, min: 1, max: 40320 },
  restore: { path: 'antinuke.restore', default: true },
  autoPanic: { path: 'antinuke.autoPanic', default: true },
  panicMinutes: { path: 'antinuke.panicMinutes', default: 30, min: 5, max: 1440 },
  panicStripRoles: { path: 'antinuke.panicStripRoles', default: true }
};
for (const [action, def] of Object.entries(ACTION_DEFS)) {
  SETTINGS[`${action}Limit`] = { path: `antinuke.limits.${action}.limit`, default: def.limit, min: 0, max: 100 };
  SETTINGS[`${action}Window`] = { path: `antinuke.limits.${action}.windowSec`, default: def.windowSec, min: 1, max: 86400 };
}

/**
 * Coerces a stored value to the setting's shape; invalid values fall back to the default.
 * @param {object} def
 * @param {*} value
 */
function coerce(def, value) {
  if (def.kind === 'id') return typeof value === 'string' && /^\d{15,25}$/.test(value) ? value : def.default;
  if (typeof def.default === 'boolean') return typeof value === 'boolean' ? value : def.default;
  if (typeof def.default === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return def.default;
    return Math.min(def.max, Math.max(def.min, Math.round(n)));
  }
  return def.options?.includes(value) ? value : def.default;
}

/**
 * Reads the antinuke configuration of a guild with defaults applied.
 * `limits[action]` is { limit, windowSec }.
 * @param {{get: Function}} guildStore
 */
function readConfig(guildStore) {
  const cfg = { limits: {} };
  for (const [key, def] of Object.entries(SETTINGS)) {
    const value = coerce(def, guildStore.get(def.path, def.default));
    const m = /^(\w+?)(Limit|Window)$/.exec(key);
    if (m && ACTION_DEFS[m[1]]) {
      cfg.limits[m[1]] = cfg.limits[m[1]] || {};
      cfg.limits[m[1]][m[2] === 'Limit' ? 'limit' : 'windowSec'] = value;
    } else cfg[key] = value;
  }
  return cfg;
}

/**
 * The limit that applies right now (panic mode lowers it to 0).
 * @param {ReturnType<typeof readConfig>} cfg
 * @param {string} action
 * @param {boolean} panic
 */
function effectiveLimit(cfg, action, panic) {
  const base = cfg.limits[action];
  return { limit: panic && !PANIC_EXEMPT.has(action) ? 0 : base.limit, windowSec: base.windowSec };
}

/**
 * @param {number} count Actions inside the window, the current one included.
 * @param {number} limit
 */
const isTriggered = (count, limit) => count > limit;

const DANGEROUS = PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles
  | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers
  | PermissionFlagsBits.ManageWebhooks | PermissionFlagsBits.MentionEveryone | PermissionFlagsBits.ModerateMembers
  | PermissionFlagsBits.ManageGuildExpressions;

/**
 * Dangerous permission bits present in `next` but not in `prev`.
 * @param {string|bigint} prev
 * @param {string|bigint} next
 * @returns {bigint}
 */
function dangerousAdded(prev, next) {
  return BigInt(next ?? 0) & ~BigInt(prev ?? 0) & DANGEROUS;
}

/** @param {string|bigint} bits */
const hasDangerous = (bits) => (BigInt(bits ?? 0) & DANGEROUS) !== 0n;

/**
 * Permissions to put back after a dangerous grant: other edits made at the same
 * time are kept, only the newly granted dangerous bits are removed.
 * @param {string|bigint} prev
 * @param {string|bigint} next
 */
function revertedPermissions(prev, next) {
  return BigInt(next ?? 0) & ~dangerousAdded(prev, next);
}

const change = (changes, key) => (changes || []).find((c) => c.key === key);

// Guild settings watched by "guildUpdate", mapped to Guild#edit option names.
const GUILD_KEYS = {
  name: 'name', icon_hash: 'icon', banner_hash: 'banner', splash_hash: 'splash',
  verification_level: 'verificationLevel', explicit_content_filter: 'explicitContentFilter',
  default_message_notifications: 'defaultMessageNotifications', afk_channel_id: 'afkChannel',
  system_channel_id: 'systemChannel', rules_channel_id: 'rulesChannel', public_updates_channel_id: 'publicUpdatesChannel'
};
const IMAGE_PATHS = { icon: 'icons', banner: 'banners', splash: 'splashes' };

/**
 * Maps an audit log entry to an antinuke action, or null if it is not watched.
 * Only needs { action, changes }, so tests can pass plain objects.
 * @param {{action: number, changes?: Array<{key: string, old?: any, new?: any}>}} entry
 * @returns {string|null}
 */
function classify(entry) {
  switch (entry.action) {
    case AuditLogEvent.ChannelDelete: return 'channelDelete';
    case AuditLogEvent.ChannelCreate: return 'channelCreate';
    case AuditLogEvent.RoleDelete: return 'roleDelete';
    case AuditLogEvent.RoleCreate: return 'roleCreate';
    case AuditLogEvent.RoleUpdate: {
      const p = change(entry.changes, 'permissions');
      return p && dangerousAdded(p.old, p.new) ? 'rolePermGrant' : null;
    }
    case AuditLogEvent.MemberRoleUpdate: return change(entry.changes, '$add') ? 'memberRoleGrant' : null;
    case AuditLogEvent.MemberBanAdd: return 'ban';
    case AuditLogEvent.MemberKick: return 'kick';
    case AuditLogEvent.MemberPrune: return 'prune';
    case AuditLogEvent.WebhookCreate: return 'webhookCreate';
    case AuditLogEvent.EmojiDelete: return 'emojiDelete';
    case AuditLogEvent.StickerDelete: return 'stickerDelete';
    case AuditLogEvent.GuildUpdate:
      if (change(entry.changes, 'vanity_url_code')) return 'vanity';
      return (entry.changes || []).some((c) => GUILD_KEYS[c.key]) ? 'guildUpdate' : null;
    default: return null;
  }
}

/**
 * Builds the Guild#edit payload that puts watched settings back, plus the old
 * vanity code if it changed.
 * @param {Array<{key: string, old?: any}>} changes
 * @param {string} guildId
 * @returns {{edit: object, vanity: string|null}}
 */
function guildRevert(changes, guildId) {
  const edit = {};
  let vanity = null;
  for (const c of changes || []) {
    if (c.key === 'vanity_url_code') { vanity = c.old ?? null; continue; }
    const opt = GUILD_KEYS[c.key];
    if (!opt) continue;
    if (IMAGE_PATHS[opt]) {
      const ext = String(c.old || '').startsWith('a_') ? 'gif' : 'png';
      edit[opt] = c.old ? `https://cdn.discordapp.com/${IMAGE_PATHS[opt]}/${guildId}/${c.old}.${ext}?size=1024` : null;
    } else edit[opt] = c.old ?? null;
  }
  return { edit, vanity };
}

const raw = (o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() });

/**
 * Plain, JSON-safe copy of a channel with everything needed to re-create it.
 * @param {import('discord.js').GuildChannel} c
 */
function channelSnapshot(c) {
  return {
    id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null, position: c.rawPosition ?? c.position ?? 0,
    topic: c.topic ?? null, nsfw: c.nsfw ?? false, rateLimitPerUser: c.rateLimitPerUser ?? null,
    bitrate: c.bitrate ?? null, userLimit: c.userLimit ?? null, rtcRegion: c.rtcRegion ?? null, videoQualityMode: c.videoQualityMode ?? null,
    defaultAutoArchiveDuration: c.defaultAutoArchiveDuration ?? null,
    availableTags: c.availableTags ? c.availableTags.map((tag) => ({ name: tag.name, moderated: tag.moderated, emoji: tag.emoji })) : null,
    defaultReactionEmoji: c.defaultReactionEmoji ?? null, defaultSortOrder: c.defaultSortOrder ?? null, defaultForumLayout: c.defaultForumLayout ?? null,
    overwrites: c.permissionOverwrites ? [...c.permissionOverwrites.cache.values()].map(raw) : []
  };
}

/**
 * Fallback snapshot from the audit entry when the channel was not cached.
 * @param {string} id
 * @param {Array<{key: string, old?: any}>} changes
 */
function channelSnapshotFromChanges(id, changes) {
  const get = (k) => change(changes, k)?.old;
  return {
    id, name: get('name') || 'restored', type: get('type') ?? ChannelType.GuildText, parentId: null, position: 0,
    topic: get('topic') ?? null, nsfw: get('nsfw') ?? false, rateLimitPerUser: get('rate_limit_per_user') ?? null,
    bitrate: get('bitrate') ?? null, userLimit: get('user_limit') ?? null,
    overwrites: (get('permission_overwrites') || []).map((o) => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) }))
  };
}

/**
 * GuildChannelManager#create options from a snapshot. Overwrites pointing to a
 * deleted role or a member who left would make Discord reject the request, so
 * they are dropped.
 * @param {ReturnType<typeof channelSnapshot>} snap
 * @param {{exists: (id: string) => boolean, parentExists: (id: string) => boolean, maxBitrate?: number}} env
 */
function channelCreateOptions(snap, env) {
  const opts = { name: snap.name, type: snap.type, position: snap.position };
  if (snap.type !== ChannelType.GuildCategory && snap.parentId && env.parentExists(snap.parentId)) opts.parent = snap.parentId;
  const copy = ['topic', 'nsfw', 'rateLimitPerUser', 'userLimit', 'rtcRegion', 'videoQualityMode', 'defaultAutoArchiveDuration', 'availableTags', 'defaultReactionEmoji', 'defaultSortOrder', 'defaultForumLayout'];
  for (const k of copy) if (snap[k] !== null && snap[k] !== undefined) opts[k] = snap[k];
  if (snap.bitrate) opts.bitrate = Math.min(snap.bitrate, env.maxBitrate || snap.bitrate);
  opts.permissionOverwrites = (snap.overwrites || []).filter((o) => env.exists(o.id)).map((o) => ({ id: o.id, type: o.type, allow: BigInt(o.allow), deny: BigInt(o.deny) }));
  return opts;
}

/**
 * Plain copy of a role, its members and the channel overwrites that used it.
 * Taken from the cache right when the role is deleted (discord.js still has both).
 * @param {import('discord.js').Role} role
 * @param {Iterable<{id: string, _roles?: string[]}>} members
 * @param {Iterable<import('discord.js').GuildChannel>} channels
 */
function roleSnapshot(role, members, channels) {
  const memberIds = [];
  for (const m of members) if (m._roles?.includes(role.id)) memberIds.push(m.id);
  const overwrites = [];
  for (const c of channels) {
    const o = c.permissionOverwrites?.cache.get(role.id);
    if (o) overwrites.push({ channelId: c.id, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() });
  }
  return {
    id: role.id, name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable,
    permissions: role.permissions.bitfield.toString(), position: role.position, unicodeEmoji: role.unicodeEmoji ?? null,
    members: memberIds, overwrites
  };
}

/**
 * RoleManager#create options. The bot can only create roles below its own top role.
 * @param {ReturnType<typeof roleSnapshot>} snap
 * @param {number} botTop
 */
function roleCreateOptions(snap, botTop) {
  const opts = {
    name: snap.name, color: snap.color, hoist: snap.hoist, mentionable: snap.mentionable,
    permissions: BigInt(snap.permissions), position: Math.max(1, Math.min(snap.position, botTop - 1))
  };
  if (snap.unicodeEmoji) opts.unicodeEmoji = snap.unicodeEmoji;
  return opts;
}

/**
 * Role ids to keep when stripping a member: managed roles and roles at or above
 * the bot cannot be removed anyway; the quarantine role is added.
 * @param {Array<{id: string, managed: boolean, position: number}>} roles
 * @param {number} botTop
 * @param {string} everyoneId
 * @param {string|null} [quarantineId]
 * @returns {{keep: string[], removed: string[]}}
 */
function stripPlan(roles, botTop, everyoneId, quarantineId) {
  const keep = [];
  const removed = [];
  for (const r of roles) {
    if (r.id === everyoneId || r.id === quarantineId) continue;
    (r.managed || r.position >= botTop ? keep : removed).push(r.id);
  }
  if (quarantineId) keep.push(quarantineId);
  return { keep, removed };
}

module.exports = {
  ACTION_DEFS, ACTIONS, PANIC_EXEMPT, PUNISHMENTS, SETTINGS, DANGEROUS, GUILD_KEYS,
  coerce, readConfig, effectiveLimit, isTriggered, dangerousAdded, hasDangerous, revertedPermissions,
  classify, guildRevert, channelSnapshot, channelSnapshotFromChanges, channelCreateOptions, roleSnapshot, roleCreateOptions, stripPlan
};
