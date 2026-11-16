'use strict';

const { Events } = require('discord.js');
const afk = require('../lib/afk');
const sticky = require('../lib/sticky');
const autoresponder = require('../lib/autoresponder');

module.exports = {
  event: Events.MessageCreate,
  /**
   * One listener for the three message features; each runs isolated so a failure
   * in one (e.g. a missing permission) does not stop the others.
   * @param {object} ctx
   * @param {import('discord.js').Message} message
   */
  async execute(ctx, message) {
    if (!message.guildId || message.system || !message.author) return;
    sticky.onMessage(ctx, message);
    if (message.author.bot || message.webhookId) return;
    await Promise.all([
      afk.onMessage(ctx, message).catch((err) => ctx.logger.debug(`[community] afk: ${err.message}`)),
      autoresponder.onMessage(ctx, message).catch((err) => ctx.logger.debug(`[community] autoresponder: ${err.message}`))
    ]);
  }
};
