'use strict';

const { Events, AuditLogEvent, ChannelType } = require('discord.js');
const { fetchExecutor } = require('../../../core/audit');
const { isEnabled } = require('../lib/config');
const { truncate, userLabel, diffPermissions } = require('../lib/format');

/**
 * Sends a "server" log with the executor found in the audit log, when there is one.
 * @param {object} ctx
 * @param {import('discord.js').Guild} g
 * @param {{title: string, description?: string, fields?: object[], audit?: number, targetId?: string}} opts
 */
async function sendServer(ctx, g, opts) {
  const fields = [...(opts.fields || [])];
  if (opts.audit) {
    const found = await fetchExecutor(g, opts.audit, opts.targetId, { retries: 2, delayMs: 700 });
    if (found) fields.push({ name: ctx.t(g, 'logs:events.moderation.by'), value: userLabel(found.executor) });
  }
  await ctx.modlog.send(g, 'server', ctx.embeds.base({ title: opts.title, description: opts.description, fields }));
}

/**
 * Lists "label: before → after" lines for the properties that changed.
 * @param {Array<[string, any, any]>} pairs [label, before, after]
 * @returns {string[]}
 */
function changes(pairs) {
  return pairs.filter(([, a, b]) => a !== b).map(([label, a, b]) => `**${label}**: ${truncate(a ?? '-', 200) || '-'} → ${truncate(b ?? '-', 200) || '-'}`);
}

const typeName = (t, g, type) => t(g, `logs:channelTypes.${ChannelType[type] || 'Other'}`);

const permFields = (t, g, before, after) => {
  const { added, removed } = diffPermissions(before, after);
  const out = [];
  if (added.length) out.push({ name: t(g, 'logs:events.server.permsAdded'), value: truncate(added.join(', '), 1024) });
  if (removed.length) out.push({ name: t(g, 'logs:events.server.permsRemoved'), value: truncate(removed.join(', '), 1024) });
  return out;
};

const overwriteKey = (ch) => [...ch.permissionOverwrites.cache.values()].map((o) => `${o.id}:${o.allow.bitfield}:${o.deny.bitfield}`).sort().join('|');

module.exports = [
  {
    event: Events.ChannelCreate,
    async execute(ctx, channel) {
      const g = channel.guild;
      if (!g || !isEnabled(ctx.store, g.id, 'server')) return;
      const { t } = ctx;
      await sendServer(ctx, g, { title: t(g, 'logs:events.server.channelCreate'), description: t(g, 'logs:events.server.channelDesc', { channel: `<#${channel.id}>`, name: channel.name, type: typeName(t, g, channel.type) }), audit: AuditLogEvent.ChannelCreate, targetId: channel.id });
    }
  },
  {
    event: Events.ChannelDelete,
    async execute(ctx, channel) {
      const g = channel.guild;
      if (!g || !isEnabled(ctx.store, g.id, 'server')) return;
      const { t } = ctx;
      await sendServer(ctx, g, { title: t(g, 'logs:events.server.channelDelete'), description: t(g, 'logs:events.server.channelDesc', { channel: `#${channel.name}`, name: channel.name, type: typeName(t, g, channel.type) }), audit: AuditLogEvent.ChannelDelete, targetId: channel.id });
    }
  },
  {
    event: Events.ChannelUpdate,
    async execute(ctx, oldCh, newCh) {
      const g = newCh.guild;
      if (!g || !isEnabled(ctx.store, g.id, 'server')) return;
      const { t } = ctx;
      const lines = changes([
        [t(g, 'logs:fields.name'), oldCh.name, newCh.name],
        [t(g, 'logs:fields.topic'), oldCh.topic, newCh.topic],
        [t(g, 'logs:fields.nsfw'), String(!!oldCh.nsfw), String(!!newCh.nsfw)],
        [t(g, 'logs:fields.slowmode'), oldCh.rateLimitPerUser ?? 0, newCh.rateLimitPerUser ?? 0],
        [t(g, 'logs:fields.category'), oldCh.parent?.name, newCh.parent?.name],
        [t(g, 'logs:fields.bitrate'), oldCh.bitrate, newCh.bitrate],
        [t(g, 'logs:fields.userLimit'), oldCh.userLimit, newCh.userLimit]
      ]);
      const overwrites = oldCh.permissionOverwrites && newCh.permissionOverwrites && overwriteKey(oldCh) !== overwriteKey(newCh);
      if (overwrites) lines.push(t(g, 'logs:events.server.overwritesChanged'));
      // Position-only updates fire for every sibling when one channel moves: not worth a log each.
      if (!lines.length) return;
      await sendServer(ctx, g, { title: t(g, 'logs:events.server.channelUpdate'), description: `<#${newCh.id}>\n${lines.join('\n')}`, audit: overwrites ? null : AuditLogEvent.ChannelUpdate, targetId: newCh.id });
    }
  },
  {
    event: Events.GuildRoleCreate,
    async execute(ctx, role) {
      const g = role.guild;
      if (!isEnabled(ctx.store, g.id, 'server')) return;
      const { t } = ctx;
      await sendServer(ctx, g, { title: t(g, 'logs:events.server.roleCreate'), description: `<@&${role.id}> (${role.name})`, audit: AuditLogEvent.RoleCreate, targetId: role.id });
    }
  },
  {
    event: Events.GuildRoleDelete,
    async execute(ctx, role) {
      const g = role.guild;
      if (!isEnabled(ctx.store, g.id, 'server')) return;
      const { t } = ctx;
      await sendServer(ctx, g, { title: t(g, 'logs:events.server.roleDelete'), description: `${role.name} (\`${role.id}\`)`, audit: AuditLogEvent.RoleDelete, targetId: role.id });
    }
  },
  {
    event: Events.GuildRoleUpdate,
    async execute(ctx, oldRole, newRole) {
      const g = newRole.guild;
      if (!isEnabled(ctx.store, g.id, 'server')) return;
      const { t } = ctx;
      const lines = changes([
        [t(g, 'logs:fields.name'), oldRole.name, newRole.name],
        [t(g, 'logs:fields.color'), oldRole.hexColor, newRole.hexColor],
        [t(g, 'logs:fields.hoist'), String(oldRole.hoist), String(newRole.hoist)],
        [t(g, 'logs:fields.mentionable'), String(oldRole.mentionable), String(newRole.mentionable)]
      ]);
      const fields = permFields(t, g, oldRole.permissions.bitfield, newRole.permissions.bitfield);
      if (!lines.length && !fields.length) return;
      await sendServer(ctx, g, { title: t(g, 'logs:events.server.roleUpdate'), description: [`<@&${newRole.id}>`, ...lines].join('\n'), fields, audit: AuditLogEvent.RoleUpdate, targetId: newRole.id });
    }
  },
  {
    event: Events.GuildEmojiCreate,
    async execute(ctx, emoji) {
      const g = emoji.guild;
      if (!isEnabled(ctx.store, g.id, 'server')) return;
      await sendServer(ctx, g, { title: ctx.t(g, 'logs:events.server.emojiCreate'), description: `${emoji} \`:${emoji.name}:\``, audit: AuditLogEvent.EmojiCreate, targetId: emoji.id });
    }
  },
  {
    event: Events.GuildEmojiDelete,
    async execute(ctx, emoji) {
      const g = emoji.guild;
      if (!isEnabled(ctx.store, g.id, 'server')) return;
      await sendServer(ctx, g, { title: ctx.t(g, 'logs:events.server.emojiDelete'), description: `\`:${emoji.name}:\` (\`${emoji.id}\`)`, audit: AuditLogEvent.EmojiDelete, targetId: emoji.id });
    }
  },
  {
    event: Events.GuildEmojiUpdate,
    async execute(ctx, oldEmoji, newEmoji) {
      const g = newEmoji.guild;
      if (oldEmoji.name === newEmoji.name || !isEnabled(ctx.store, g.id, 'server')) return;
      await sendServer(ctx, g, { title: ctx.t(g, 'logs:events.server.emojiUpdate'), description: `${newEmoji} \`:${oldEmoji.name}:\` → \`:${newEmoji.name}:\``, audit: AuditLogEvent.EmojiUpdate, targetId: newEmoji.id });
    }
  },
  {
    event: Events.GuildUpdate,
    async execute(ctx, oldGuild, g) {
      if (!isEnabled(ctx.store, g.id, 'server')) return;
      const { t } = ctx;
      const lines = changes([
        [t(g, 'logs:fields.name'), oldGuild.name, g.name],
        [t(g, 'logs:fields.icon'), oldGuild.icon, g.icon],
        [t(g, 'logs:fields.banner'), oldGuild.banner, g.banner],
        [t(g, 'logs:fields.vanity'), oldGuild.vanityURLCode, g.vanityURLCode],
        [t(g, 'logs:fields.verificationLevel'), oldGuild.verificationLevel, g.verificationLevel],
        [t(g, 'logs:fields.owner'), oldGuild.ownerId && `<@${oldGuild.ownerId}>`, g.ownerId && `<@${g.ownerId}>`],
        [t(g, 'logs:fields.afkChannel'), oldGuild.afkChannelId && `<#${oldGuild.afkChannelId}>`, g.afkChannelId && `<#${g.afkChannelId}>`],
        [t(g, 'logs:fields.systemChannel'), oldGuild.systemChannelId && `<#${oldGuild.systemChannelId}>`, g.systemChannelId && `<#${g.systemChannelId}>`]
      ]);
      if (!lines.length) return;
      await sendServer(ctx, g, { title: t(g, 'logs:events.server.guildUpdate'), description: lines.join('\n'), audit: AuditLogEvent.GuildUpdate });
    }
  }
];
module.exports.changes = changes;
