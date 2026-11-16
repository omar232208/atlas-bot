'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { lockChannel } = require('../lib/locks');
const { respond, fail, explainError, permName } = require('../lib/format');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Prevent @everyone from talking in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const { guild } = interaction;
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.permissionOverwrites) return fail(ctx, interaction, 'moderation:errors.badChannel');
    if (!ctx.permissions.botCan(guild, PermissionFlagsBits.ManageRoles, channel) || !ctx.permissions.botCan(guild, PermissionFlagsBits.ManageChannels, channel)) {
      return fail(ctx, interaction, 'moderation:errors.botMissing', { perm: `${permName(t, interaction, 'ManageChannels')}, ${permName(t, interaction, 'ManageRoles')}` });
    }
    const reason = interaction.options.getString('reason');
    let changed;
    try {
      changed = await lockChannel(channel, ctx.store.guild(guild.id), `${interaction.user.tag}: ${reason || '/lock'}`.slice(0, 512));
    } catch (err) {
      return explainError(ctx, interaction, err, 'ManageRoles');
    }
    if (!changed) return fail(ctx, interaction, 'moderation:errors.alreadyLocked');
    const notice = embeds.info(t(guild, 'moderation:lock.notice'), reason ? t(guild, 'moderation:lock.reasonLine', { reason }) : undefined);
    // The reply already shows in the current channel; announce only elsewhere.
    if (channel.id !== interaction.channelId && channel.isTextBased?.()) await channel.send({ embeds: [notice] }).catch(() => {});
    return respond(interaction, embeds.success(t(interaction, 'moderation:lock.title'), t(interaction, 'moderation:lock.done', { channel: `<#${channel.id}>` }), { footer: reason || undefined }));
  }
};
