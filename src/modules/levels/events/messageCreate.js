'use strict';

const { Events } = require('discord.js');
const { isEnabled, getConfig } = require('../lib/settings');
const { awardMessage } = require('../lib/ledger');
const { grantRewards } = require('../lib/rewards');

/**
 * Every human message on an enabled server can earn XP (once per cooldown).
 * On a level-up the member gets the announcement and any reward roles.
 */
module.exports = {
  event: Events.MessageCreate,
  async execute(ctx, message) {
    if (!message.guild || !message.member || message.author.bot) return;
    const guildId = message.guildId;
    if (!isEnabled(ctx.store, guildId)) return;
    const cfg = getConfig(ctx.store, guildId);
    const result = awardMessage(ctx.store, guildId, message.author.id, cfg, Date.now(), Math.random);
    if (!result.awarded || result.to <= result.from) return;

    await grantRewards(ctx, message.guild, message.member, result.from, result.to);
    if (!cfg.announce) return;
    const channel = (cfg.announceChannel && message.guild.channels.cache.get(cfg.announceChannel)) || message.channel;
    const embed = ctx.embeds.success(
      ctx.t({ guildId }, 'levels:levelUp.title'),
      ctx.t({ guildId }, 'levels:levelUp.text', { user: message.author.toString(), level: result.to })
    );
    await channel.send({ embeds: [embed] }).catch((err) => ctx.logger.warn('levels: announce failed:', err.message));
  }
};
