'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, fail, explainError } = require('../lib/format');
const duration = require('../../../core/duration');

const MAX_SECONDS = 21600;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set the slowmode of a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((o) => o.setName('duration').setDescription('Delay between messages, e.g. 10s, 5m; "off" to disable').setRequired(true).setMaxLength(20))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.PublicThread, ChannelType.PrivateThread)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.setRateLimitPerUser) return fail(ctx, interaction, 'moderation:errors.badChannel');
    const raw = interaction.options.getString('duration', true).trim().toLowerCase();
    const off = ['0', 'off', 'none', 'non', 'aus', 'no', 'nao', 'não'].includes(raw);
    // Bare numbers mean seconds here: that is how Discord shows slowmode.
    const ms = off ? 0 : /^\d+$/.test(raw) ? Number(raw) * 1000 : duration.parse(raw);
    if (ms === null || ms > MAX_SECONDS * 1000) return fail(ctx, interaction, 'moderation:errors.badSlowmode');
    try {
      await channel.setRateLimitPerUser(Math.round(ms / 1000), `${interaction.user.tag}: /slowmode`);
    } catch (err) {
      return explainError(ctx, interaction, err, 'ManageChannels');
    }
    const text = ms ? t(interaction, 'moderation:slowmode.set', { channel: `<#${channel.id}>`, duration: duration.format(ms, interaction) }) : t(interaction, 'moderation:slowmode.off', { channel: `<#${channel.id}>` });
    return respond(interaction, embeds.success(t(interaction, 'moderation:slowmode.title'), text));
  }
};
