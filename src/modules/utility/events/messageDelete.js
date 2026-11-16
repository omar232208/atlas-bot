'use strict';

const { Events } = require('discord.js');
const cache = require('../snipe-cache');
const { readSetting } = require('../settings');

module.exports = {
  event: Events.MessageDelete,
  /**
   * Keeps the deleted message for /snipe, but only on servers that turned the
   * feature on. Bots are skipped, and so are messages with nothing to show.
   * @param {object} ctx
   * @param {import('discord.js').Message|import('discord.js').PartialMessage} message
   */
  async execute(ctx, message) {
    if (!message.guildId || message.author?.bot) return;
    if (!readSetting(message.guildId, 'utility.snipe.enabled')) return;
    const attachments = [...(message.attachments?.values() ?? [])].map((a) => a.name ?? a.url);
    const content = message.content ?? '';
    if (!content && !attachments.length) return;
    cache.remember(message.channelId, {
      authorId: message.author?.id ?? '0',
      authorName: message.author?.username ?? '?',
      content,
      attachments
    });
  }
};
