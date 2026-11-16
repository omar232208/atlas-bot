'use strict';

const {
  ActionRowBuilder, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits,
  SlashCommandBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const en = require('../en');
const permissions = require('../../../core/permissions');

/** How long the modal stays open before the builder gives up. */
const MODAL_TIME_MS = 5 * 60 * 1000;
const COLOR_RE = /^#?([0-9a-f]{6})$/i;
const IMAGE_RE = /^https:\/\/\S+$/i;

/** One text input of the modal. Short inputs are single line. */
const input = (id, label, style, maxLength, required = false) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setMaxLength(maxLength).setRequired(required)
);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription(en('utility:commands.embed.description'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption((o) => o.setName('channel').setDescription(en('utility:commands.embed.options.channel')).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

  /**
   * Opens a modal to write an embed, then posts it. The modal is answered by
   * the same command interaction, so nothing needs to be routed by prefix.
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const reject = (key, vars) => interaction.reply({ embeds: [embeds.error(t(interaction, key, vars))], flags: MessageFlags.Ephemeral });

    if (!permissions.botCan(interaction.guild, 'SendMessages', channel)) {
      return reject('utility:errors.missingBotPerm', { perm: t(interaction, 'utility:errors.permSendMessages') });
    }
    if (!permissions.botCan(interaction.guild, 'EmbedLinks', channel)) {
      return reject('utility:errors.missingBotPerm', { perm: t(interaction, 'utility:errors.permEmbedLinks') });
    }

    const modalId = `utl:embed:${interaction.id}`;
    const modal = new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(t(interaction, 'utility:embed.modalTitle'))
      .addComponents(
        input('title', t(interaction, 'utility:embed.fields.title'), TextInputStyle.Short, 256),
        input('description', t(interaction, 'utility:embed.fields.description'), TextInputStyle.Paragraph, 4000),
        input('color', t(interaction, 'utility:embed.fields.color'), TextInputStyle.Short, 7),
        input('footer', t(interaction, 'utility:embed.fields.footer'), TextInputStyle.Short, 2048),
        input('image', t(interaction, 'utility:embed.fields.image'), TextInputStyle.Short, 500)
      );
    await interaction.showModal(modal);

    const submitted = await interaction.awaitModalSubmit({
      time: MODAL_TIME_MS,
      filter: (i) => i.customId === modalId && i.user.id === interaction.user.id
    }).catch(() => null);
    // Timed out: nothing is posted and nothing needs to be said to the user.
    if (!submitted) return null;

    const reply = (embed) => submitted.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    const read = (id) => submitted.fields.getTextInputValue(id).trim();
    const title = read('title');
    const description = read('description');
    const color = read('color');
    const footer = read('footer');
    const image = read('image');

    if (!title && !description) return reply(embeds.error(t(submitted, 'utility:errors.embedEmpty')));
    if (color && !COLOR_RE.test(color)) return reply(embeds.error(t(submitted, 'utility:errors.invalidColor')));
    if (image && !IMAGE_RE.test(image)) return reply(embeds.error(t(submitted, 'utility:errors.invalidUrl')));

    const embed = new EmbedBuilder();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (color) embed.setColor(parseInt(COLOR_RE.exec(color)[1], 16));
    if (footer) embed.setFooter({ text: footer });
    if (image) embed.setImage(image);

    // _keepEmbeds: this command exists to build embeds, so it opts out of the
    // bot-wide embed→text flattening in core/plain.js.
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] }, _keepEmbeds: true });
    return reply(embeds.success(t(submitted, 'utility:embed.title'), t(submitted, 'utility:embed.sent', { channel: channel.toString() })));
  }
};
