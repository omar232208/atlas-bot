'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const en = require('../en');
const cache = require('../snipe-cache');
const { readSetting } = require('../settings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('snipe')
    .setDescription(en('utility:commands.snipe.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) => sub
      .setName('show')
      .setDescription(en('utility:commands.snipe.options.show.description'))
      .addChannelOption((o) => o.setName('channel').setDescription(en('utility:commands.snipe.options.show.options.channel')))
      .addIntegerOption((o) => o.setName('index').setDescription(en('utility:commands.snipe.options.show.options.index')).setMinValue(1).setMaxValue(cache.MAX_PER_CHANNEL)))
    .addSubcommand((sub) => sub
      .setName('enable')
      .setDescription(en('utility:commands.snipe.options.enable.description')))
    .addSubcommand((sub) => sub
      .setName('disable')
      .setDescription(en('utility:commands.snipe.options.disable.description'))),

  /**
   * Shows a message deleted recently. Switching the feature on or off needs
   * Manage Server, because it decides whether deleted messages are kept at all.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const sub = interaction.options.getSubcommand();
    const reply = (embed, ephemeral = true) => interaction.reply({ embeds: [embed], flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    if (sub === 'enable' || sub === 'disable') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return reply(embeds.error(t(interaction, 'utility:errors.missingUserPerm', { perm: t(interaction, 'utility:errors.permManageGuild') })));
      }
      const enable = sub === 'enable';
      ctx.store.guild(interaction.guildId).set('utility.snipe.enabled', enable);
      return reply(embeds.success(t(interaction, 'utility:snipe.title'), t(interaction, enable ? 'utility:snipe.enabled' : 'utility:snipe.disabled')));
    }

    if (!readSetting(interaction.guildId, 'utility.snipe.enabled')) {
      return reply(embeds.warn(t(interaction, 'utility:snipe.title'), t(interaction, 'utility:snipe.off')));
    }
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const index = interaction.options.getInteger('index') ?? 1;
    const entries = cache.recent(channel.id);
    const entry = entries[index - 1];
    if (!entry) {
      return reply(embeds.info(t(interaction, 'utility:snipe.title'), t(interaction, 'utility:snipe.none')));
    }
    const fields = [
      { name: t(interaction, 'utility:snipe.author'), value: `<@${entry.authorId}> (${entry.authorName})`, inline: true },
      { name: t(interaction, 'utility:snipe.when'), value: `<t:${Math.floor(entry.deletedAt / 1000)}:R>`, inline: true }
    ];
    if (entry.attachments.length) {
      fields.push({ name: t(interaction, 'utility:snipe.attachments', { count: entry.attachments.length }), value: entry.attachments.join('\n').slice(0, 1000), inline: false });
    }
    const body = entry.content || t(interaction, 'utility:snipe.noText');
    return reply(embeds.info(t(interaction, 'utility:snipe.title'), body.slice(0, 4000), { fields, footer: t(interaction, 'utility:snipe.position', { index, total: entries.length, channel: channel.name }) }));
  }
};
