'use strict';

const dashboardCommand = require('./commands/dashboard');
const state = require('./lib/state');

/**
 * Web dashboard module: a small HTTP server (node:http only) that renders every
 * module's `dashboard` schema. It starts only when a port is configured
 * (DASHBOARD_PORT, PORT or SERVER_PORT), so a bot without a public port pays nothing.
 */
module.exports = {
  name: 'dashboard',
  commands: [dashboardCommand],
  events: [],
  components: [],

  /**
   * Starts the HTTP server when a port is configured.
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  async init(client, ctx) {
    await state.start(ctx);
  },

  /** Closes the HTTP server on graceful shutdown. */
  async shutdown() {
    await state.stop();
  }
};
