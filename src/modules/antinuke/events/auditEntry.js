'use strict';

const { Events } = require('discord.js');
const { classify, channelSnapshotFromChanges, hasDangerous } = require('../logic');
const { snapshots, waitFor } = require('../memory');
const { handle } = require('../guard');

const SNAPSHOT_WAIT_MS = 3000;
const change = (entry, key) => entry.changes?.find((c) => c.key === key);

/**
 * Collects what undoing this entry will need. Returns null when the entry turns
 * out not to be dangerous (for example roles given to a member without any
 * dangerous permission).
 * @param {import('discord.js').Guild} guild
 * @param {string} action
 * @param {import('discord.js').GuildAuditLogsEntry} entry
 */
async function buildData(guild, action, entry) {
  const snap = () => snapshots.get(`${guild.id}:${entry.targetId}`);
  switch (action) {
    case 'channelDelete':
      return (await waitFor(snap, SNAPSHOT_WAIT_MS)) || channelSnapshotFromChanges(entry.targetId, entry.changes);
    case 'roleDelete': {
      const s = await waitFor(snap, SNAPSHOT_WAIT_MS);
      if (s) return s;
      const old = (k, d) => change(entry, k)?.old ?? d;
      return { id: entry.targetId, name: old('name', 'restored'), color: old('color', 0), hoist: old('hoist', false), mentionable: old('mentionable', false), permissions: String(old('permissions', '0')), position: 1, members: [], overwrites: [] };
    }
    case 'emojiDelete':
    case 'stickerDelete':
      return (await waitFor(snap, SNAPSHOT_WAIT_MS)) || null;
    case 'rolePermGrant':
      return { old: String(change(entry, 'permissions').old ?? '0') };
    case 'memberRoleGrant': {
      const roleIds = (change(entry, '$add').new || []).map((r) => r.id).filter((id) => {
        const role = guild.roles.cache.get(id);
        return role && hasDangerous(role.permissions.bitfield);
      });
      return roleIds.length ? { roleIds } : null;
    }
    case 'guildUpdate':
    case 'vanity':
      return { changes: entry.changes.map((c) => ({ key: c.key, old: c.old ?? null })) };
    default:
      return {};
  }
}

module.exports = {
  event: Events.GuildAuditLogEntryCreate,
  /**
   * Single entry point of the antinuke: the audit log entry names the executor
   * directly, which stays exact even when dozens of actions happen per second.
   * @param {object} ctx
   * @param {import('discord.js').GuildAuditLogsEntry} entry
   * @param {import('discord.js').Guild} guild
   */
  async execute(ctx, entry, guild) {
    const action = classify(entry);
    if (!action || !entry.executorId || entry.executorId === ctx.client.user?.id) return;
    if (ctx.permissions.isWhitelisted(guild, entry.executorId)) return;
    const data = await buildData(guild, action, entry);
    if (data === null && action === 'memberRoleGrant') return;
    await handle(ctx, guild, entry.executorId, { action, targetId: entry.targetId ?? null, data });
  }
};
