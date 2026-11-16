'use strict';

const { Events } = require('discord.js');
const invites = require('../lib/invites');
const duration = require('../../../core/duration');
const { userLabel, stamp } = require('../lib/format');

/**
 * Caches the invites of every guild. Done one guild at a time so a bot in many
 * servers does not burst the REST rate limit at startup.
 * @param {import('discord.js').Client} client
 */
async function cacheAll(client) {
  for (const guild of client.guilds.cache.values()) await invites.cacheGuild(guild);
}

module.exports = [
  { event: Events.ClientReady, once: true, execute: (ctx, client) => cacheAll(client) },
  { event: Events.GuildCreate, execute: (ctx, guild) => invites.cacheGuild(guild) },
  { event: Events.GuildDelete, execute: (ctx, guild) => invites.forgetGuild(guild.id) },
  {
    event: Events.InviteCreate,
    async execute(ctx, invite) {
      invites.trackInvite(invite, false);
      const g = invite.guild;
      if (!g?.channels) return;
      const { t } = ctx;
      const fields = [
        { name: t(g, 'logs:events.invites.code'), value: `\`${invite.code}\``, inline: true },
        { name: t(g, 'logs:events.invites.channel'), value: invite.channelId ? `<#${invite.channelId}>` : '-', inline: true },
        { name: t(g, 'logs:events.invites.maxUses'), value: invite.maxUses ? String(invite.maxUses) : t(g, 'logs:events.unlimited'), inline: true },
        { name: t(g, 'logs:events.invites.expires'), value: invite.expiresTimestamp ? `${stamp(invite.expiresTimestamp)} (${duration.format(invite.maxAge * 1000, g)})` : t(g, 'logs:events.never'), inline: true }
      ];
      if (invite.inviter) fields.unshift({ name: t(g, 'logs:events.invites.creator'), value: userLabel(invite.inviter) });
      await ctx.modlog.send(g, 'invites', ctx.embeds.base({ title: t(g, 'logs:events.invites.created'), fields }));
    }
  },
  {
    event: Events.InviteDelete,
    async execute(ctx, invite) {
      invites.trackInvite(invite, true);
      const g = invite.guild;
      if (!g?.channels) return;
      await ctx.modlog.send(g, 'invites', ctx.embeds.base({ title: ctx.t(g, 'logs:events.invites.deleted'), description: `\`${invite.code}\`${invite.channelId ? ` · <#${invite.channelId}>` : ''}` }));
    }
  }
];
module.exports.cacheAll = cacheAll;
