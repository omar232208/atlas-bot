'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { t } = require('./i18n');

/**
 * Builds the previous / page x/y / next button row.
 * @param {*} lang Language target.
 * @param {number} index
 * @param {number} total
 * @param {string} prefix Custom id prefix.
 * @param {boolean} [disabled]
 */
function navRow(lang, index, total, prefix, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}prev`).setStyle(ButtonStyle.Secondary).setLabel(t(lang, 'common:pagination.previous')).setDisabled(disabled || index === 0),
    new ButtonBuilder().setCustomId(`${prefix}page`).setStyle(ButtonStyle.Secondary).setLabel(t(lang, 'common:pagination.page', { page: index + 1, total })).setDisabled(true),
    new ButtonBuilder().setCustomId(`${prefix}next`).setStyle(ButtonStyle.Secondary).setLabel(t(lang, 'common:pagination.next')).setDisabled(disabled || index >= total - 1)
  );
}

/**
 * Replies with a paginated list of embeds. Only the user who ran the command can
 * turn pages. This is short-lived (in-memory collector, default 5 minutes): for
 * menus that must survive a restart, use component routing instead.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').EmbedBuilder[]} pages
 * @param {{ephemeral?: boolean, timeMs?: number}} [opts]
 */
async function paginate(interaction, pages, opts = {}) {
  const { ephemeral = false, timeMs = 300000 } = opts;
  if (!pages.length) throw new Error('paginate: no pages');
  const send = (payload) => (interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply({ ...payload, flags: ephemeral ? MessageFlags.Ephemeral : undefined, withResponse: true }).then((r) => r.resource.message));
  if (pages.length === 1) return send({ embeds: [pages[0]], components: [] });

  const prefix = `paginate:${interaction.id}:`;
  let index = 0;
  const message = await send({ embeds: [pages[0]], components: [navRow(interaction, 0, pages.length, prefix)] });
  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: timeMs, filter: (i) => i.customId.startsWith(prefix) });
  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: t(i, 'common:errors.notYourButton'), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    index = i.customId.endsWith('next') ? Math.min(index + 1, pages.length - 1) : Math.max(index - 1, 0);
    await i.update({ embeds: [pages[index]], components: [navRow(interaction, index, pages.length, prefix)] }).catch(() => {});
  });
  collector.on('end', () => {
    interaction.editReply({ components: [navRow(interaction, index, pages.length, prefix, true)] }).catch(() => {});
  });
  return message;
}

/**
 * Splits lines into embed descriptions of at most `perPage` lines.
 * @param {string[]} lines
 * @param {number} [perPage]
 * @returns {string[]}
 */
function chunk(lines, perPage = 10) {
  const out = [];
  for (let i = 0; i < lines.length; i += perPage) out.push(lines.slice(i, i + perPage).join('\n'));
  return out;
}

module.exports = { paginate, chunk, navRow };
