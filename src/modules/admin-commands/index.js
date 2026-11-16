'use strict';

const { SETTINGS, getSettings, dashboard } = require('./lib/config');

/**
 * Admin Commands: per-guild command role requirements.
 * Allows server admins to restrict specific commands to certain roles
 * (e.g. a "Pro Bot" role) via the dashboard, overriding Discord's
 * default_member_permissions check.
 */
module.exports = {
  name: 'admin-commands',
  commands: [],
  events: [],
  components: [],
  dashboard,

  /** Expose helpers for the command router to check custom role requirements. */
  async init(client, ctx) {
    ctx.adminCommands = { SETTINGS, getSettings };
  }
};