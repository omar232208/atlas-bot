'use strict';

const { Events } = require('discord.js');
const { channelSnapshot, roleSnapshot } = require('../logic');
const { snapshots, orphans } = require('../memory');

// The audit log entry only says *who* deleted something; the full object (to
// re-create it) comes with these gateway events, so it is kept a few minutes.
module.exports = [
  {
    event: Events.ChannelDelete,
    execute(ctx, channel) {
      if (!channel.guild) return;
      snapshots.set(`${channel.guild.id}:${channel.id}`, channelSnapshot(channel));
    }
  },
  {
    event: Events.ChannelUpdate,
    execute(ctx, oldChannel, newChannel) {
      // Children of a deleted category lose their parent: remember where they were.
      if (newChannel.guild && oldChannel.parentId && !newChannel.parentId) orphans.set(`${newChannel.guild.id}:${oldChannel.parentId}:${newChannel.id}`, newChannel.id);
    }
  },
  {
    event: Events.GuildRoleDelete,
    execute(ctx, role) {
      snapshots.set(`${role.guild.id}:${role.id}`, roleSnapshot(role, role.guild.members.cache.values(), role.guild.channels.cache.values()));
    }
  },
  {
    event: Events.GuildEmojiDelete,
    execute(ctx, emoji) {
      snapshots.set(`${emoji.guild.id}:${emoji.id}`, { id: emoji.id, name: emoji.name, url: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png' }) });
    }
  },
  {
    event: Events.GuildStickerDelete,
    execute(ctx, sticker) {
      if (!sticker.guildId) return;
      snapshots.set(`${sticker.guildId}:${sticker.id}`, { id: sticker.id, name: sticker.name, tags: sticker.tags, description: sticker.description, format: sticker.format, url: sticker.url });
    }
  }
];
