'use strict';

const { Events } = require('discord.js');
const starboard = require('../lib/starboard');

module.exports = {
  event: Events.MessageReactionRemove,
  /**
   * @param {object} ctx
   * @param {import('discord.js').MessageReaction} reaction
   * @param {import('discord.js').User} user
   */
  async execute(ctx, reaction, user) {
    if (user?.bot) return;
    await starboard.onReaction(ctx, reaction);
  }
};
