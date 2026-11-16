'use strict';

const { Events, AttachmentBuilder } = require('discord.js');
const { PATHS, DEFAULTS, isIgnoredChannel } = require('../lib/config');
const { truncate, block, userLabel, transcript } = require('../lib/format');

/**
 * Whether a message must be skipped: DMs, ignored channels, bots (by default),
 * and system messages that carry no user content.
 */
function skip(ctx, message) {
  if (!message.guild) return true;
  const get = ctx.store.guild(message.guild.id).get;
  if (isIgnoredChannel(get, message.channelId, message.channel?.parentId)) return true;
  if (message.author?.bot && get(PATHS.ignoreBots, DEFAULTS.ignoreBots)) return true;
  if (message.webhookId) return true;
  return false;
}

const attachmentsField = (t, guild, message) => {
  if (!message.attachments?.size) return [];
  const value = truncate([...message.attachments.values()].map((a) => `[${a.name}](${a.url})`).join('\n'), 1024);
  return [{ name: t(guild, 'logs:events.messages.attachments'), value }];
};

module.exports = [
  {
    event: Events.MessageUpdate,
    async execute(ctx, oldMessage, newMessage) {
      if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => null);
      if (!newMessage || skip(ctx, newMessage)) return;
      // Embed unfurls fire an update with identical content; only real edits matter.
      if (oldMessage.partial || oldMessage.content === newMessage.content) return;
      const { t } = ctx;
      const g = newMessage.guild;
      const embed = ctx.embeds.base({
        title: t(g, 'logs:events.messages.edited'),
        description: t(g, 'logs:events.messages.editedDesc', { user: userLabel(newMessage.author), channel: `<#${newMessage.channelId}>`, url: newMessage.url }),
        fields: [
          { name: t(g, 'logs:events.messages.before'), value: oldMessage.content ? block(oldMessage.content) : t(g, 'logs:events.empty') },
          { name: t(g, 'logs:events.messages.after'), value: newMessage.content ? block(newMessage.content) : t(g, 'logs:events.empty') }
        ],
        footer: t(g, 'logs:events.ids', { user: newMessage.author.id, message: newMessage.id })
      });
      if (newMessage.author.displayAvatarURL) embed.setThumbnail(newMessage.author.displayAvatarURL());
      await ctx.modlog.send(g, 'messages', embed);
    }
  },
  {
    event: Events.MessageDelete,
    async execute(ctx, message) {
      if (!message.guild) return;
      const { t } = ctx;
      const g = message.guild;
      // Without a cached copy Discord only tells us an id: still worth a short line.
      if (message.partial) {
        if (isIgnoredChannel(ctx.store.guild(g.id).get, message.channelId, message.channel?.parentId)) return;
        const embed = ctx.embeds.base({
          title: t(g, 'logs:events.messages.deleted'),
          description: t(g, 'logs:events.messages.deletedUncached', { channel: `<#${message.channelId}>`, id: message.id })
        });
        await ctx.modlog.send(g, 'messages', embed);
        return;
      }
      if (skip(ctx, message)) return;
      const embed = ctx.embeds.base({
        title: t(g, 'logs:events.messages.deleted'),
        description: t(g, 'logs:events.messages.deletedDesc', { user: userLabel(message.author), channel: `<#${message.channelId}>` }),
        fields: [
          { name: t(g, 'logs:events.messages.content'), value: message.content ? block(message.content) : t(g, 'logs:events.empty') },
          ...attachmentsField(t, g, message)
        ],
        footer: t(g, 'logs:events.ids', { user: message.author.id, message: message.id })
      });
      if (message.author.displayAvatarURL) embed.setThumbnail(message.author.displayAvatarURL());
      await ctx.modlog.send(g, 'messages', embed);
    }
  },
  {
    event: Events.MessageBulkDelete,
    async execute(ctx, messages, channel) {
      const g = channel?.guild;
      if (!g || isIgnoredChannel(ctx.store.guild(g.id).get, channel.id, channel.parentId)) return;
      const { t } = ctx;
      const known = [...messages.values()].filter((m) => !m.partial);
      const embed = ctx.embeds.base({
        title: t(g, 'logs:events.messages.bulk'),
        description: t(g, 'logs:events.messages.bulkDesc', { count: messages.size, channel: `<#${channel.id}>`, known: known.length })
      });
      const extra = {};
      if (known.length) {
        const file = new AttachmentBuilder(Buffer.from(transcript(known), 'utf8'), { name: `bulk-delete-${channel.id}-${Date.now()}.txt` });
        extra.files = [file];
      }
      const sent = await ctx.modlog.send(g, 'messages', embed, extra);
      // Missing Attach Files: still report the purge without the transcript.
      if (!sent && extra.files) await ctx.modlog.send(g, 'messages', embed);
    }
  }
];
