'use strict';

const { Events } = require('discord.js');
const { handleMessage } = require('../lib/handler');

/**
 * Re-checks edited messages: editing a clean message into an insult or an
 * invite is the oldest automod bypass. Embed-only updates (link previews)
 * keep the same content and are ignored.
 */
module.exports = {
  event: Events.MessageUpdate,
  async execute(ctx, oldMessage, newMessage) {
    if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => null);
    if (!newMessage || oldMessage.content === newMessage.content) return;
    await handleMessage(ctx, newMessage, { edited: true });
  }
};
