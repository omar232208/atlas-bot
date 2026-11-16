'use strict';

const i18n = require('../../core/i18n');

/**
 * English text for slash command metadata. Discord shows the localized
 * descriptions itself (registry.js), this value is only the base description
 * that SlashCommandBuilder requires.
 * @param {string} key e.g. "fun:commands.dice.description"
 * @returns {string}
 */
module.exports = (key) => i18n.t('en', key);
