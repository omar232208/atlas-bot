'use strict';

const { ActionRowBuilder, ButtonBuilder } = require('discord.js');

/** Discord allows at most five buttons per row and five rows per message. */
const ROW_SIZE = 5;

/**
 * One button. Each module keeps its own copy of this helper so modules stay
 * independent: none of them imports code from another module.
 * @param {{id: string, label: string, style: number, disabled?: boolean}} spec
 */
function button({ id, label, style, disabled = false }) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

/** Groups buttons into action rows of at most five. */
function rows(buttons) {
  const out = [];
  for (let i = 0; i < buttons.length; i += ROW_SIZE) {
    out.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + ROW_SIZE)));
  }
  return out;
}

/** The same rows with every button disabled, rebuilt from the specs. */
function disableAll(buttons) {
  return rows(buttons.map((b) => ButtonBuilder.from(b.toJSON()).setDisabled(true)));
}

module.exports = { ROW_SIZE, button, rows, disableAll };
