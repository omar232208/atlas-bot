'use strict';

const { Events } = require('discord.js');
const { readConfig, createWindow, joinVerdict, isRaid } = require('../logic');
const { getRaid, startRaid, punishJoiner, handleBotJoin, report } = require('../raid');

// Recent joins per guild. In memory only: a raid is a burst of seconds, so
// nothing is lost when the bot restarts.
const joins = createWindow();

module.exports = {
  event: Events.GuildMemberAdd,
  joins,
  /**
   * Runs the anti-bot check, raid detection, raid mode actions and join filters.
   * @param {object} ctx
   * @param {import('discord.js').GuildMember} member
   */
  async execute(ctx, member) {
    const guild = member.guild;
    const cfg = readConfig(ctx.store.guild(guild.id));
    if (member.user.bot) {
      if (cfg.enabled && cfg.antiBot) await handleBotJoin(ctx, member, cfg);
      return;
    }
    if (ctx.permissions.isWhitelisted(guild, member.id)) return;

    if (cfg.enabled) {
      const recent = joins.hit(guild.id, cfg.joinWindowSec * 1000, member.id);
      if (!getRaid(ctx.store, guild.id) && isRaid(recent.length, cfg)) {
        const started = await startRaid(ctx, guild, { by: null, auto: true, durationMs: cfg.raidDurationMin * 60000, joins: recent.length });
        // The members of the burst that triggered detection are raiders too.
        if (started && cfg.punishBurst) {
          for (const id of recent) {
            if (id === member.id) continue;
            const m = guild.members.cache.get(id);
            if (m && !ctx.permissions.isWhitelisted(guild, id) && await punishJoiner(ctx, m, cfg.raidAction, 'raid', cfg)) count(ctx, guild);
          }
        }
      }
    }

    if (getRaid(ctx.store, guild.id)) {
      if (await punishJoiner(ctx, member, cfg.raidAction, 'raid', cfg)) count(ctx, guild);
      return;
    }
    if (!cfg.enabled) return;
    const verdict = joinVerdict(cfg, { createdAt: member.user.createdTimestamp, hasAvatar: !!member.user.avatar }, Date.now());
    if (!verdict) return;
    if (await punishJoiner(ctx, member, cfg.filterAction, verdict, cfg)) {
      const embed = ctx.embeds.info(ctx.t(guild, 'antiraid:filter.title'), ctx.t(guild, 'antiraid:filter.description', {
        user: `${member.user.tag} (${member.id})`,
        reason: ctx.t(guild, `antiraid:reasons.${verdict}`),
        action: ctx.t(guild, `antiraid:actions.${cfg.filterAction}`)
      }), { timestamp: true });
      await report(ctx, guild, embed);
    }
  }
};

function count(ctx, guild) {
  const gs = ctx.store.guild(guild.id);
  if (gs.get('antiraid.raid.active')) gs.update('antiraid.raid.punished', (n) => (n || 0) + 1, 0);
}
