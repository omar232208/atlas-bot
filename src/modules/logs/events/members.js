'use strict';

const { Events, AuditLogEvent } = require('discord.js');
const { fetchExecutor } = require('../../../core/audit');
const duration = require('../../../core/duration');
const invites = require('../lib/invites');
const { isEnabled } = require('../lib/config');
const { userLabel, stamp, diffLists, roleList } = require('../lib/format');

// Accounts younger than this are flagged on join: a common raid / alt signal.
const NEW_ACCOUNT_MS = 7 * 86400000;

/** Who did it, unless it was this bot (its own actions are logged by the module that made them). */
async function humanExecutor(guild, type, targetId) {
  const found = await fetchExecutor(guild, type, targetId, { retries: 2, delayMs: 700 });
  if (!found || found.executor.id === guild.client.user.id) return found ? 'self' : null;
  return found;
}

async function logInviteJoin(ctx, member) {
  const { t } = ctx;
  const g = member.guild;
  const result = await invites.resolveJoin(g);
  invites.recordJoin(ctx.store.guild(g.id), member.id, result);
  let description;
  if (result.type === 'invite') {
    description = t(g, 'logs:events.invites.usedInvite', { user: userLabel(member.user), code: result.code, inviter: result.inviterId ? `<@${result.inviterId}>` : t(g, 'logs:events.unknown'), uses: result.uses });
  } else if (result.type === 'vanity') {
    description = t(g, 'logs:events.invites.usedVanity', { user: userLabel(member.user), code: result.code, uses: result.uses });
  } else if (result.type === 'untracked') {
    description = t(g, 'logs:events.invites.untracked', { user: userLabel(member.user) });
  } else {
    description = t(g, 'logs:events.invites.unknownInvite', { user: userLabel(member.user) });
  }
  if (result.inviterId) {
    const stats = invites.getInviteStats(ctx.store.guild(g.id)).find((s) => s.userId === result.inviterId);
    if (stats) description += `\n${t(g, 'logs:events.invites.inviterTotal', { joins: stats.joins, left: stats.left, net: stats.net })}`;
  }
  await ctx.modlog.send(g, 'invites', ctx.embeds.base({ title: t(g, 'logs:events.invites.joinTitle'), description }));
}

module.exports = [
  {
    event: Events.GuildMemberAdd,
    async execute(ctx, member) {
      const { t } = ctx;
      const g = member.guild;
      const age = Date.now() - member.user.createdTimestamp;
      const fields = [
        { name: t(g, 'logs:events.members.created'), value: `${stamp(member.user.createdTimestamp, 'f')} (${stamp(member.user.createdTimestamp)})`, inline: true },
        { name: t(g, 'logs:events.members.count'), value: String(g.memberCount), inline: true }
      ];
      if (age < NEW_ACCOUNT_MS) fields.push({ name: t(g, 'logs:events.members.warning'), value: t(g, 'logs:events.members.newAccount', { age: duration.format(age, g) }) });
      const embed = ctx.embeds.base({
        title: t(g, member.user.bot ? 'logs:events.members.botJoined' : 'logs:events.members.joined'),
        description: userLabel(member.user),
        fields
      }).setThumbnail(member.user.displayAvatarURL());
      await ctx.modlog.send(g, 'members', embed);
      if (!member.user.bot) await logInviteJoin(ctx, member);
    }
  },
  {
    event: Events.GuildMemberRemove,
    async execute(ctx, member) {
      const { t } = ctx;
      const g = member.guild;
      const roles = member.partial ? [] : member.roles.cache.filter((r) => r.id !== g.id).map((r) => r.id);
      const fields = [];
      if (member.joinedTimestamp) fields.push({ name: t(g, 'logs:events.members.joinedAt'), value: `${stamp(member.joinedTimestamp, 'f')} (${duration.format(Date.now() - member.joinedTimestamp, g)})` });
      if (roles.length) fields.push({ name: t(g, 'logs:events.members.roles'), value: roleList(roles) });
      const embed = ctx.embeds.base({ title: t(g, 'logs:events.members.left'), description: userLabel(member.user), fields }).setThumbnail(member.user.displayAvatarURL());
      await ctx.modlog.send(g, 'members', embed);

      const entry = invites.recordLeave(ctx.store.guild(g.id), member.id);
      if (entry?.inviterId) {
        await ctx.modlog.send(g, 'invites', ctx.embeds.base({
          title: t(g, 'logs:events.invites.leaveTitle'),
          description: t(g, 'logs:events.invites.leftInvited', { user: userLabel(member.user), inviter: `<@${entry.inviterId}>`, code: entry.code || '-' })
        }));
      }

      // A kick looks like a leave on the gateway; the audit log tells them apart.
      if (!isEnabled(ctx.store, g.id, 'moderation')) return;
      const kick = await humanExecutor(g, AuditLogEvent.MemberKick, member.id);
      if (kick && kick !== 'self') {
        await ctx.modlog.send(g, 'moderation', ctx.embeds.base({
          title: t(g, 'logs:events.moderation.kick'),
          fields: [
            { name: t(g, 'logs:events.moderation.target'), value: userLabel(member.user) },
            { name: t(g, 'logs:events.moderation.by'), value: userLabel(kick.executor) },
            { name: t(g, 'logs:events.moderation.reason'), value: kick.entry.reason || t(g, 'logs:events.noReason') }
          ]
        }));
      }
    }
  },
  {
    event: Events.GuildMemberUpdate,
    async execute(ctx, oldMember, newMember) {
      // Without the previous state there is nothing reliable to compare.
      if (oldMember.partial) return;
      const { t } = ctx;
      const g = newMember.guild;
      const user = userLabel(newMember.user);

      if (oldMember.nickname !== newMember.nickname) {
        await ctx.modlog.send(g, 'members', ctx.embeds.base({
          title: t(g, 'logs:events.members.nickname'),
          description: user,
          fields: [
            { name: t(g, 'logs:events.before'), value: oldMember.nickname || t(g, 'logs:events.none'), inline: true },
            { name: t(g, 'logs:events.after'), value: newMember.nickname || t(g, 'logs:events.none'), inline: true }
          ]
        }));
      }

      const { added, removed } = diffLists([...oldMember.roles.cache.keys()], [...newMember.roles.cache.keys()]);
      if (added.length || removed.length) {
        const fields = [];
        if (added.length) fields.push({ name: t(g, 'logs:events.members.rolesAdded'), value: roleList(added) });
        if (removed.length) fields.push({ name: t(g, 'logs:events.members.rolesRemoved'), value: roleList(removed) });
        const by = isEnabled(ctx.store, g.id, 'members') ? await humanExecutor(g, AuditLogEvent.MemberRoleUpdate, newMember.id) : null;
        if (by && by !== 'self') fields.push({ name: t(g, 'logs:events.moderation.by'), value: userLabel(by.executor) });
        await ctx.modlog.send(g, 'members', ctx.embeds.base({ title: t(g, 'logs:events.members.rolesChanged'), description: user, fields }));
      }

      const before = oldMember.communicationDisabledUntilTimestamp || 0;
      const after = newMember.communicationDisabledUntilTimestamp || 0;
      const now = Date.now();
      if (before !== after && (after > now || before > now) && isEnabled(ctx.store, g.id, 'moderation')) {
        const by = await humanExecutor(g, AuditLogEvent.MemberUpdate, newMember.id);
        // Timeouts made through this bot are logged as cases by the moderation module.
        if (by !== 'self') {
          const fields = [{ name: t(g, 'logs:events.moderation.target'), value: user }];
          if (after > now) fields.push({ name: t(g, 'logs:events.moderation.until'), value: `${stamp(after, 'f')} (${stamp(after)})` });
          if (by) fields.push({ name: t(g, 'logs:events.moderation.by'), value: userLabel(by.executor) }, { name: t(g, 'logs:events.moderation.reason'), value: by.entry.reason || t(g, 'logs:events.noReason') });
          await ctx.modlog.send(g, 'moderation', ctx.embeds.base({ title: t(g, after > now ? 'logs:events.moderation.timeout' : 'logs:events.moderation.untimeout'), fields }));
        }
      }

      if (!oldMember.premiumSinceTimestamp && newMember.premiumSinceTimestamp) {
        await ctx.modlog.send(g, 'members', ctx.embeds.base({ title: t(g, 'logs:events.members.boost'), description: user }));
      }
    }
  }
];
