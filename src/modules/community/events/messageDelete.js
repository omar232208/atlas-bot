'use strict';

const { Events } = require('discord.js');
const { COLLECTIONS } = require('../lib/config');
const starboard = require('../lib/starboard');
const sticky = require('../lib/sticky');

module.exports = {
  event: Events.MessageDelete,
  /**
   * Keeps starboard and sticky data consistent with deleted messages.
   * @param {object} ctx
   * @param {import('discord.js').Message|import('discord.js').PartialMessage} message
   */
  async execute(ctx, message) {
    if (!message.guild) return;
    const g = ctx.store.guild(message.guild.id);
    if (g.get([...COLLECTIONS.starboardPosts.split('.'), message.id], null)) await starboard.removePost(ctx, message.guild, message.id);
    // A sticky deleted by hand is posted again so it stays "sticky".
    const st = g.get(sticky.stickyPath(message.channelId), null);
    if (st?.messageId === message.id && message.channel && !sticky.wasOwnDelete(message.id)) {
      g.set(sticky.stickyPath(message.channelId), { ...st, messageId: null });
      await sticky.repost(ctx, message.channel).catch(() => {});
    }
  }
};
