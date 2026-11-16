'use strict';

const { Events } = require('discord.js');
const { setting } = require('../lib/config');
const starboard = require('../lib/starboard');

module.exports = {
  event: Events.MessageReactionRemoveAll,
  /**
   * A moderator clearing reactions takes the message off the starboard.
   * @param {object} ctx
   * @param {import('discord.js').Message} message
   */
  async execute(ctx, message) {
    if (!message.guild || !setting(ctx.store.guild(message.guild.id), 'community.starboard.enabled')) return;
    await starboard.removePost(ctx, message.guild, message.id);
  }
};
