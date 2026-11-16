'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, respond, ensureBotPerms, clip } = require('../lib/util');
const sticky = require('../lib/sticky');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice];
const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];

module.exports = {
  name: 'sticky',
  /** Member permission checked at runtime: /community mixes features of different staff levels. */
  permission: PermissionFlagsBits.ManageMessages,
  /**
   * Adds this subcommand group to /community.
   * @param {import('discord.js').SlashCommandSubcommandGroupBuilder} group
   */
  build: (group) => group
    .setName('sticky')
    .setDescription(en('commands.community.options.sticky.description'))
    .addSubcommand((sc) => sc.setName('set').setDescription(en('commands.community.options.sticky.options.set.description'))
      .addChannelOption((o) => o.setName('channel').setDescription(en('commands.community.options.sticky.options.set.options.channel')).addChannelTypes(...TEXT)))
    .addSubcommand((sc) => sc.setName('remove').setDescription(en('commands.community.options.sticky.options.remove.description'))
      .addChannelOption((o) => o.setName('channel').setDescription(en('commands.community.options.sticky.options.remove.options.channel')).addChannelTypes(...TEXT)))
    .addSubcommand((sc) => sc.setName('list').setDescription(en('commands.community.options.sticky.options.list.description'))),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const g = ctx.store.guild(interaction.guildId);

    if (sub === 'set') {
      if (!channel?.isTextBased?.()) return fail(interaction, ctx, 'sticky.badChannel');
      if (!(await ensureBotPerms(interaction, ctx, NEEDED, channel))) return null;
      // A modal allows multi-line text that a slash option cannot hold.
      return interaction.showModal(sticky.modal(interaction, ctx.t, channel.id, g.get(sticky.stickyPath(channel.id), null)));
    }
    if (sub === 'remove') {
      if (!(await sticky.removeSticky(ctx, interaction.guild, channel.id))) return fail(interaction, ctx, 'sticky.none', { channel: `<#${channel.id}>` });
      return ok(interaction, ctx, 'sticky.removed', null, { channel: `<#${channel.id}>` });
    }
    const entries = Object.entries(g.get(COLLECTIONS.sticky, {}));
    if (!entries.length) return fail(interaction, ctx, 'sticky.listEmpty');
    const lines = entries.map(([id, s]) => `<#${id}> — ${clip((s.title || s.content).replace(/\s+/g, ' '), 80)}`);
    return respond(interaction, ctx.embeds.info(ctx.t(interaction, `${NS}:sticky.listTitle`, { count: entries.length }), lines.join('\n')), { ephemeral: true });
  }
};
