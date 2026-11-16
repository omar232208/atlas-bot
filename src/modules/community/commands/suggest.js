'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createCooldowns } = require('../../../core/cooldown');
const { setting, COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, ensureBotPerms, apiError } = require('../lib/util');
const service = require('../lib/suggestionService');

// Own tracker so the delay can follow the per-guild setting.
const cooldowns = createCooldowns();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription(en('commands.suggest.description'))
    .addStringOption((o) => o.setName('idea').setDescription(en('commands.suggest.options.idea')).setRequired(true).setMinLength(10).setMaxLength(2000))
    .addBooleanOption((o) => o.setName('anonymous').setDescription(en('commands.suggest.options.anonymous'))),

  /**
   * Posts a suggestion in the configured channel with vote buttons.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const g = ctx.store.guild(interaction.guildId);
    const channelId = setting(g, 'community.suggestions.channelId');
    const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
    if (!channel?.isTextBased?.()) return fail(interaction, ctx, 'suggestions.notConfigured');

    const waitMs = cooldowns.remaining(`${interaction.guildId}:${interaction.user.id}`);
    if (waitMs > 0) return fail(interaction, ctx, 'errors.cooldown', { time: `<t:${Math.ceil((Date.now() + waitMs) / 1000)}:R>` });

    const threads = setting(g, 'community.suggestions.threads');
    const perms = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (threads) perms.push(PermissionFlagsBits.CreatePublicThreads);
    if (!(await ensureBotPerms(interaction, ctx, perms, channel))) return null;

    // Anonymous is allowed per suggestion only when the server enables it globally,
    // or forced for everyone when the server setting is on.
    const anonymous = setting(g, 'community.suggestions.anonymous') || interaction.options.getBoolean('anonymous') === true;
    const counterPath = COLLECTIONS.suggestionCounter.split('.');
    const number = g.update(counterPath, (n) => (Number(n) || 0) + 1, 0);
    const item = {
      number,
      authorId: interaction.user.id,
      content: interaction.options.getString('idea', true),
      anonymous,
      status: 'pending',
      up: [],
      down: [],
      channelId: channel.id,
      messageId: null,
      createdAt: Date.now()
    };

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const message = await channel.send(await service.render(ctx, interaction.guild, item));
      item.messageId = message.id;
      service.saveItem(ctx, interaction.guildId, item);
      if (threads) {
        await message.startThread({ name: ctx.t(interaction.guild, `${NS}:suggestions.threadName`, { number }).slice(0, 100) }).catch(() => {});
      }
      cooldowns.hit(`${interaction.guildId}:${interaction.user.id}`, Math.max(0, Number(setting(g, 'community.suggestions.cooldown')) || 0) * 1000);
      return ok(interaction, ctx, 'suggestions.posted', 'suggestions.postedDesc', { number, url: message.url });
    } catch (err) {
      return apiError(interaction, ctx, err);
    }
  }
};
