'use strict';

const crypto = require('node:crypto');
const { MessageFlags } = require('discord.js');

const NS = 'backup';
const KEY = 'backup.items';

/** Defaults of the settings stored under "backup.config" (shared with the dashboard schema). */
const DEFAULTS = Object.freeze({
  maxBackups: 10,
  autoInterval: 0,
  autoKeep: 3
});

/**
 * Reads the backup settings of a guild merged with defaults.
 * @param {object} store
 * @param {string} guildId
 */
function getConfig(store, guildId) {
  return { ...DEFAULTS, ...store.guild(guildId).get('backup.config', {}) };
}

/**
 * Backups live in the global store, not the guild file: a backup must survive
 * the server being nuked or deleted, and be loadable into a new server.
 * @param {object} store
 * @returns {Record<string, object>}
 */
const all = (store) => store.global().get(KEY, {});

/**
 * Backups visible to a user from a guild: those of this guild, plus those the
 * user created anywhere (to restore into a replacement server).
 * @param {object} store
 * @param {string} guildId
 * @param {string} userId
 */
function visible(store, guildId, userId) {
  return Object.values(all(store))
    .filter((b) => b.guildId === guildId || b.authorId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Picks which backups to delete so a guild keeps at most `max` manual and
 * `keepAuto` automatic backups (oldest go first). Pure (tested).
 * @param {object[]} backups Backups of one guild.
 * @param {{max: number, keepAuto: number}} limits
 * @returns {string[]} Ids to delete.
 */
function pruneIds(backups, limits) {
  const newestFirst = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  const manual = newestFirst.filter((b) => !b.auto).slice(limits.max);
  const auto = newestFirst.filter((b) => b.auto).slice(limits.keepAuto);
  return [...manual, ...auto].map((b) => b.id);
}

/**
 * Stores a snapshot and enforces the per-guild limits.
 * @param {object} store
 * @param {{guildId: string, guildName: string, authorId: string, name?: string, auto?: boolean, data: object}} input
 * @returns {object} The stored backup.
 */
function save(store, input) {
  const id = crypto.randomBytes(5).toString('hex');
  // Strictly increasing per guild: two saves in the same millisecond must not tie, or pruning could drop the newest one.
  const latest = Object.values(all(store)).filter((b) => b.guildId === input.guildId).reduce((max, b) => Math.max(max, b.createdAt || 0), 0);
  const createdAt = Math.max(Date.now(), latest + 1);
  const entry = { id, name: input.name || null, guildId: input.guildId, guildName: input.guildName, authorId: input.authorId, auto: !!input.auto, createdAt, data: input.data };
  store.global().set(`${KEY}.${id}`, entry);
  const config = getConfig(store, input.guildId);
  const own = Object.values(all(store)).filter((b) => b.guildId === input.guildId);
  for (const old of pruneIds(own, { max: config.maxBackups, keepAuto: config.autoKeep })) store.global().delete(`${KEY}.${old}`);
  return entry;
}

/** @returns {object|null} */
const get = (store, id) => all(store)[String(id || '').trim().toLowerCase()] || null;
/** @returns {boolean} */
const remove = (store, id) => store.global().delete(`${KEY}.${id}`);

/** Replies or edits the deferred reply with an embed (ephemeral). */
async function respond(interaction, embed, extra = {}) {
  const payload = { embeds: [embed], components: [], ...extra };
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch {
    return null;
  }
}

/** Localized error reply. */
function fail(interaction, ctx, key, vars) {
  return respond(interaction, ctx.embeds.error(ctx.t(interaction, `${NS}:errors.title`), ctx.t(interaction, `${NS}:${key}`, vars)));
}

module.exports = { NS, KEY, DEFAULTS, getConfig, all, visible, pruneIds, save, get, remove, respond, fail };
