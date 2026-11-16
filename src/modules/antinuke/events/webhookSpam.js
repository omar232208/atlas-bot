'use strict';

const { Events, MessageFlags } = require('discord.js');
const { readConfig, effectiveLimit, isTriggered } = require('../logic');
const { createWindow } = require('../memory');
const { report } = require('../panic');

const messages = createWindow();
// Webhooks already being deleted, so the burst that follows does not log twice.
const handling = new Set();

module.exports = {
  event: Events.MessageCreate,
  /**
   * Anti webhook spam: a webhook posting faster than the limit is deleted with
   * its recent messages. The webhook owner is not punished, because spam
   * usually comes from a leaked webhook URL, not from the person who made it.
   * @param {object} ctx
   * @param {import('discord.js').Message} message
   */
  async execute(ctx, message) {
    if (!message.guild || !message.webhookId) return;
    // Interaction replies and followed-channel crossposts also carry a webhookId.
    if (message.applicationId || message.interactionMetadata || message.flags.has(MessageFlags.IsCrosspost)) return;
    const cfg = readConfig(ctx.store.guild(message.guild.id));
    if (!cfg.enabled) return;
    const { limit, windowSec } = effectiveLimit(cfg, 'webhookSpam', false);
    const key = `${message.guild.id}:${message.webhookId}`;
    const recent = messages.hit(key, windowSec * 1000, { id: message.id, channelId: message.channelId });
    if (!isTriggered(recent.length, limit) || handling.has(key)) return;
    handling.add(key);
    try {
      const guild = message.guild;
      const reason = ctx.t(guild, 'antinuke:reason', { action: ctx.t(guild, 'antinuke:actions.webhookSpam') });
      const hook = await ctx.client.fetchWebhook(message.webhookId).catch(() => null);
      const deleted = hook ? await hook.delete(reason).then(() => true).catch(() => false) : false;
      let removed = 0;
      const channel = message.channel;
      if (channel?.bulkDelete) {
        const ids = recent.filter((m) => m.channelId === channel.id).map((m) => m.id);
        removed = await channel.bulkDelete(ids, true).then((c) => c.size).catch(() => 0);
      }
      messages.clear(key);
      await report(ctx, guild, ctx.embeds.error(ctx.t(guild, 'antinuke:webhook.title'), ctx.t(guild, 'antinuke:webhook.description', {
        name: hook?.name || message.author?.username || '?', channel: `<#${message.channelId}>`, count: recent.length, seconds: windowSec
      }), {
        fields: [
          { name: ctx.t(guild, 'antinuke:webhook.deleted'), value: ctx.t(guild, deleted ? 'antinuke:webhook.yes' : 'antinuke:webhook.no'), inline: true },
          { name: ctx.t(guild, 'antinuke:webhook.removed'), value: String(removed), inline: true }
        ],
        timestamp: true
      }));
    } finally {
      setTimeout(() => handling.delete(key), 30000).unref?.();
    }
  }
};
