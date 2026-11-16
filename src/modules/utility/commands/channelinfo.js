'use strict';

const { ChannelType, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');

/** Maps a Discord channel type to a key of utility:channelinfo.types. */
function typeKey(type) {
  switch (type) {
    case ChannelType.GuildText: return 'text';
    case ChannelType.GuildVoice: return 'voice';
    case ChannelType.GuildCategory: return 'category';
    case ChannelType.GuildAnnouncement: return 'announcement';
    case ChannelType.GuildForum: return 'forum';
    case ChannelType.GuildStageVoice: return 'stage';
    case ChannelType.PublicThread:
    case ChannelType.PrivateThread:
    case ChannelType.AnnouncementThread: return 'thread';
    default: return 'other';
  }
}

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('channel')
    .setDescription(en('utility:commands.info.options.channel.description'))
    .addChannelOption((o) => o.setName('channel').setDescription(en('utility:commands.info.options.channel.options.channel'))),

  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const textLike = 'topic' in channel;
    const fields = [
      { name: t(interaction, 'utility:channelinfo.id'), value: channel.id, inline: true },
      { name: t(interaction, 'utility:channelinfo.type'), value: t(interaction, `utility:channelinfo.types.${typeKey(channel.type)}`), inline: true },
      { name: t(interaction, 'utility:channelinfo.category'), value: channel.parent?.name ?? t(interaction, 'utility:channelinfo.none'), inline: true },
      { name: t(interaction, 'utility:channelinfo.position'), value: String(channel.position ?? 0), inline: true },
      { name: t(interaction, 'utility:channelinfo.created'), value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:D>`, inline: true }
    ];
    if (textLike) {
      fields.push(
        { name: t(interaction, 'utility:channelinfo.nsfw'), value: channel.nsfw ? t(interaction, 'utility:channelinfo.yes') : t(interaction, 'utility:channelinfo.no'), inline: true },
        { name: t(interaction, 'utility:channelinfo.slowmode'), value: channel.rateLimitPerUser ? t(interaction, 'utility:channelinfo.seconds', { count: channel.rateLimitPerUser }) : t(interaction, 'utility:channelinfo.none'), inline: true },
        { name: t(interaction, 'utility:channelinfo.topic'), value: channel.topic?.slice(0, 1000) || t(interaction, 'utility:channelinfo.none'), inline: false }
      );
    }
    await interaction.reply({ embeds: [embeds.info(t(interaction, 'utility:channelinfo.title', { name: channel.name }), channel.toString(), { fields })] });
  }
};
