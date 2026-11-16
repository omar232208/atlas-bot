'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/** Discord allows at most five buttons per row and five rows per message. */
const ROW_SIZE = 5;

/**
 * One button. Labels must not be empty, so callers pass a visible placeholder.
 * @param {{id: string, label: string, style?: ButtonStyle, disabled?: boolean}} spec
 */
function button({ id, label, style = ButtonStyle.Secondary, disabled = false }) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

/**
 * Groups buttons into action rows of at most five.
 * @param {ButtonBuilder[]} buttons
 * @returns {ActionRowBuilder[]}
 */
function rows(buttons) {
  const out = [];
  for (let i = 0; i < buttons.length; i += ROW_SIZE) {
    out.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + ROW_SIZE)));
  }
  return out;
}

/**
 * Returns the same rows with every button disabled (used when a game ends).
 * Rebuilt from the specs rather than read back from the message, so it works
 * even when the message object is stale.
 * @param {ButtonBuilder[]} buttons
 */
function disableAll(buttons) {
  return rows(buttons.map((b) => ButtonBuilder.from(b.toJSON()).setDisabled(true)));
}

/**
 * Lays buttons out as a grid of `width` columns (a board needs one row per line,
 * not rows of five). Used for tic-tac-toe, where three rows of three read as a board.
 * @param {ButtonBuilder[]} buttons
 * @param {number} width
 * @returns {ActionRowBuilder[]}
 */
function grid(buttons, width) {
  const out = [];
  for (let i = 0; i < buttons.length; i += width) {
    out.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + width)));
  }
  return out;
}

module.exports = { ROW_SIZE, button, rows, grid, disableAll };
