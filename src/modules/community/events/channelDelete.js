'use strict';

const { Events } = require('discord.js');
const { setting, COLLECTIONS } = require('../lib/config');
const stats = require('../lib/stats');
const TV = require('../lib/tempvoice');
const sticky = require('../lib/sticky');

module.exports = {
  event: Events.ChannelDelete,
  /**
   * Forgets every reference to a deleted channel so no feature keeps failing on it.
   * @param {object} ctx
   * @param {import('discord.js').GuildChannel} channel
   */
  execute(ctx, channel) {
    if (!channel.guild) return;
    const g = ctx.store.guild(channel.guild.id);
    const id = channel.id;
    g.delete([...COLLECTIONS.stats.split('.'), id]);
    g.delete(TV.hubPath(id));
    g.delete(TV.tempPath(id));
    g.delete(sticky.stickyPath(id));
    stats.limiter.forget(id);
    if (setting(g, 'community.suggestions.channelId') === id) g.set('community.suggestions.channelId', null);
    if (setting(g, 'community.starboard.channelId') === id) {
      g.set('community.starboard.channelId', null);
      g.set('community.starboard.enabled', false);
    }
    if (setting(g, 'community.birthdays.channelId') === id) g.set('community.birthdays.channelId', null);
    const ignored = setting(g, 'community.starboard.ignoredChannels');
    if (ignored.includes(id)) g.set('community.starboard.ignoredChannels', ignored.filter((c) => c !== id));
  }
};
