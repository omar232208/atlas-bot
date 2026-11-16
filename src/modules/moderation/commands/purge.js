'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { matchesPurge } = require('../lib/purge');
const { respond, fail, explainError, permName } = require('../lib/format');

// Upper bound of messages read to find matches, so a filter that matches
// nothing cannot make the bot read the whole channel history.
const MAX_SCAN = 500;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages, with optional filters')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('amount').setDescription('How many messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only messages from this user'))
    .addBooleanOption((o) => o.setName('bots').setDescription('Only messages from bots'))
    .addBooleanOption((o) => o.setName('humans').setDescription('Only messages from humans'))
    .addBooleanOption((o) => o.setName('links').setDescription('Only messages containing a link'))
    .addBooleanOption((o) => o.setName('attachments').setDescription('Only messages with files'))
    .addBooleanOption((o) => o.setName('embeds').setDescription('Only messages with embeds'))
    .addStringOption((o) => o.setName('contains').setDescription('Only messages containing this text').setMaxLength(100)),
  cooldown: 5,
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const { channel, guild } = interaction;
    if (!channel?.bulkDelete) return fail(ctx, interaction, 'moderation:errors.badChannel');
    const missing = ctx.permissions.botMissing(guild, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory], channel);
    if (missing.length) return fail(ctx, interaction, 'moderation:errors.botMissing', { perm: missing.map((p) => permName(t, interaction, p)).join(', ') });
    const amount = interaction.options.getInteger('amount', true);
    const filters = {
      userId: interaction.options.getUser('user')?.id,
      bots: interaction.options.getBoolean('bots') || false,
      humans: interaction.options.getBoolean('humans') || false,
      links: interaction.options.getBoolean('links') || false,
      attachments: interaction.options.getBoolean('attachments') || false,
      embeds: interaction.options.getBoolean('embeds') || false,
      contains: interaction.options.getString('contains') || undefined
    };
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const ids = [];
      let before;
      let scanned = 0;
      let reachedOld = false;
      while (ids.length < amount && scanned < MAX_SCAN && !reachedOld) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (!batch.size) break;
        for (const msg of batch.values()) {
          if (Date.now() - msg.createdTimestamp > 14 * 86400000) { reachedOld = true; break; }
          if (ids.length < amount && matchesPurge(msg, filters)) ids.push(msg.id);
        }
        scanned += batch.size;
        before = batch.last().id;
        if (batch.size < 100) break;
      }
      if (!ids.length) return respond(interaction, embeds.info(t(interaction, 'moderation:purge.none')), true);
      const deleted = ids.length === 1 ? (await channel.messages.delete(ids[0]), 1) : (await channel.bulkDelete(ids, true)).size;
      await ctx.modlog.send(guild, 'moderation', embeds.base({
        title: t(guild, 'moderation:purge.logTitle'),
        fields: [
          { name: t(guild, 'moderation:case.moderator'), value: `<@${interaction.user.id}>`, inline: true },
          { name: t(guild, 'moderation:purge.channel'), value: `<#${channel.id}>`, inline: true },
          { name: t(guild, 'moderation:purge.count'), value: String(deleted), inline: true }
        ],
        timestamp: true
      }));
      return respond(interaction, embeds.success(t(interaction, 'moderation:purge.done', { count: deleted }), reachedOld ? t(interaction, 'moderation:purge.oldNote') : undefined), true);
    } catch (err) {
      return explainError(ctx, interaction, err, 'ManageMessages');
    }
  }
};
