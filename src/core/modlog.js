'use strict';

const logger = require('./logger').child('modlog');

let impl = null;

/**
 * Facade over the log channel sender. The "logs" module installs the real
 * implementation; before that (or without that module) send() resolves to null
 * so every module can call it unconditionally.
 */
module.exports = {
  /**
   * @param {import('discord.js').Guild} guild
   * @param {string} category messages | members | moderation | server | voice | invites (or any module-defined category)
   * @param {import('discord.js').EmbedBuilder} embed
   * @param {object} [extra] Extra message options (files, components).
   * @returns {Promise<import('discord.js').Message|null>}
   */
  async send(guild, category, embed, extra) {
    if (!impl || !guild) return null;
    try {
      return (await impl(guild, category, embed, extra)) || null;
    } catch (err) {
      logger.warn(`modlog ${category} failed in ${guild.id}:`, err.message);
      return null;
    }
  },
  /**
   * Installs the implementation (called by the logs module in init()).
   * @param {(guild, category, embed, extra) => Promise<any>} fn
   */
  setImplementation(fn) { impl = fn; },
  /** True when a log implementation is installed. */
  get ready() { return !!impl; }
};
