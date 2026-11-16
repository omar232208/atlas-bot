'use strict';

const { Events } = require('discord.js');
const stats = require('../lib/stats');
const TV = require('../lib/tempvoice');

// Counters such as channels/roles have no cheap event: a periodic pass keeps them
// right while staying far below the 2 renames / 10 min limit.
const PERIOD_MS = 10 * 60000;

module.exports = {
  event: Events.ClientReady,
  once: true,
  /**
   * @param {object} ctx
   * @param {import('discord.js').Client} client
   */
  async execute(ctx, client) {
    for (const guild of client.guilds.cache.values()) {
      await TV.cleanup(ctx, guild).catch((err) => ctx.logger.debug(`[community] tempvoice cleanup ${guild.id}: ${err.message}`));
      if (stats.hasStats(ctx, guild.id)) stats.queue(ctx, guild, 5000);
    }
    const timer = setInterval(() => {
      for (const guild of client.guilds.cache.values()) if (stats.hasStats(ctx, guild.id)) stats.queue(ctx, guild, 1000);
    }, PERIOD_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }
};
