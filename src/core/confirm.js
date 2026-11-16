'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const { t } = require('./i18n');
const embeds = require('./embeds');

/**
 * Asks the command user to confirm a destructive action with Yes / No buttons.
 * Short-lived (default 30 s). Works whether or not the interaction was already
 * answered or deferred. Afterwards the buttons are removed and the message shows
 * "Cancelled" on refusal/timeout; on confirmation the caller edits the reply
 * (interaction.editReply) with the result.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{title?: string, description: string, ephemeral?: boolean, timeMs?: number}} opts
 * @returns {Promise<boolean>}
 */
async function confirm(interaction, opts) {
  const { title = t(interaction, 'common:confirm.title'), description, ephemeral = true, timeMs = 30000 } = opts;
  const prefix = `confirm:${interaction.id}:`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}yes`).setStyle(ButtonStyle.Danger).setLabel(t(interaction, 'common:confirm.yes')),
    new ButtonBuilder().setCustomId(`${prefix}no`).setStyle(ButtonStyle.Secondary).setLabel(t(interaction, 'common:confirm.no'))
  );
  const payload = { embeds: [embeds.warn(title, description)], components: [row] };
  const message = interaction.deferred || interaction.replied
    ? await interaction.editReply(payload)
    : (await interaction.reply({ ...payload, flags: ephemeral ? MessageFlags.Ephemeral : undefined, withResponse: true })).resource.message;

  let clicked = null;
  try {
    clicked = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: timeMs,
      filter: (i) => i.customId.startsWith(prefix) && i.user.id === interaction.user.id
    });
  } catch {
    clicked = null;
  }
  const ok = clicked?.customId === `${prefix}yes`;
  if (clicked) await clicked.deferUpdate().catch(() => {});
  if (!ok) {
    const key = clicked ? 'common:confirm.cancelled' : 'common:confirm.timeout';
    await interaction.editReply({ embeds: [embeds.info(t(interaction, key))], components: [] }).catch(() => {});
  } else {
    await interaction.editReply({ components: [] }).catch(() => {});
  }
  return ok;
}

module.exports = { confirm };
