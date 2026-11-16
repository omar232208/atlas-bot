'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setting, COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, respond, ensureBotPerms } = require('../lib/util');
const { parseEmoji } = require('../lib/starboard');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('starboard')
    .setDescription(en('commands.starboard.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sc) => sc.setName('set').setDescription(en('commands.starboard.options.set.description'))
      .addChannelOption((o) => o.setName('channel').setDescription(en('commands.starboard.options.set.options.channel')).addChannelTypes(...TEXT).setRequired(true))
      .addIntegerOption((o) => o.setName('threshold').setDescription(en('commands.starboard.options.set.options.threshold')).setMinValue(1).setMaxValue(100))
      .addStringOption((o) => o.setName('emoji').setDescription(en('commands.starboard.options.set.options.emoji')).setMaxLength(64))
      .addBooleanOption((o) => o.setName('selfstar').setDescription(en('commands.starboard.options.set.options.selfstar'))))
    .addSubcommand((sc) => sc.setName('ignore').setDescription(en('commands.starboard.options.ignore.description'))
      .addChannelOption((o) => o.setName('channel').setDescription(en('commands.starboard.options.ignore.options.channel')).addChannelTypes(...TEXT).setRequired(true)))
    .addSubcommand((sc) => sc.setName('disable').setDescription(en('commands.starboard.options.disable.description')))
    .addSubcommand((sc) => sc.setName('status').setDescription(en('commands.starboard.options.status.description'))),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const g = ctx.store.guild(interaction.guildId);
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
      if (!(await ensureBotPerms(interaction, ctx, needed, channel))) return null;
      const rawEmoji = interaction.options.getString('emoji');
      const emoji = rawEmoji === null ? null : parseEmoji(rawEmoji);
      if (rawEmoji !== null && !emoji) return fail(interaction, ctx, 'starboard.badEmoji');
      g.set('community.starboard.channelId', channel.id);
      g.set('community.starboard.enabled', true);
      const threshold = interaction.options.getInteger('threshold');
      if (threshold !== null) g.set('community.starboard.threshold', threshold);
      if (emoji) g.set('community.starboard.emoji', emoji);
      const selfStar = interaction.options.getBoolean('selfstar');
      if (selfStar !== null) g.set('community.starboard.selfStar', selfStar);
      return ok(interaction, ctx, 'starboard.saved', 'starboard.savedDesc', {
        channel: `<#${channel.id}>`,
        threshold: setting(g, 'community.starboard.threshold'),
        emoji: setting(g, 'community.starboard.emoji')
      });
    }

    if (sub === 'ignore') {
      const channel = interaction.options.getChannel('channel', true);
      const list = setting(g, 'community.starboard.ignoredChannels');
      const has = list.includes(channel.id);
      g.set('community.starboard.ignoredChannels', has ? list.filter((id) => id !== channel.id) : [...list, channel.id].slice(0, 50));
      return ok(interaction, ctx, has ? 'starboard.unignored' : 'starboard.ignored', null, { channel: `<#${channel.id}>` });
    }

    if (sub === 'disable') {
      if (!setting(g, 'community.starboard.enabled')) return fail(interaction, ctx, 'starboard.alreadyOff');
      g.set('community.starboard.enabled', false);
      return ok(interaction, ctx, 'starboard.disabled');
    }

    const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
    const channelId = setting(g, 'community.starboard.channelId');
    const ignored = setting(g, 'community.starboard.ignoredChannels');
    const posts = Object.keys(g.get(COLLECTIONS.starboardPosts, {})).length;
    const embed = ctx.embeds.info(t('starboard.statusTitle'), null, {
      fields: [
        { name: t('common.state'), value: t(`common.${setting(g, 'community.starboard.enabled') ? 'on' : 'off'}`), inline: true },
        { name: t('starboard.channel'), value: channelId ? `<#${channelId}>` : t('common.none'), inline: true },
        { name: t('starboard.threshold'), value: String(setting(g, 'community.starboard.threshold')), inline: true },
        { name: t('starboard.emoji'), value: setting(g, 'community.starboard.emoji'), inline: true },
        { name: t('starboard.selfStar'), value: t(`common.${setting(g, 'community.starboard.selfStar') ? 'on' : 'off'}`), inline: true },
        { name: t('starboard.posts'), value: String(posts), inline: true },
        { name: t('starboard.ignoredList'), value: ignored.length ? ignored.map((id) => `<#${id}>`).join(' ') : t('common.none') }
      ]
    });
    return respond(interaction, embed, { ephemeral: true });
  }
};
