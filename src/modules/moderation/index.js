'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registerJobs, sanction } = require('./lib/actions');
const { dashboard } = require('./lib/config');

const load = (dir) => fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.js')).sort().map((f) => require(path.join(__dirname, dir, f)));

/**
 * Moderation: sanctions with numbered cases, DM before the sanction, temp bans
 * through the persistent scheduler and automatic sanctions on warn thresholds.
 * `sanction` is exported so automod can record cases the same way.
 */
module.exports = {
  name: 'moderation',
  commands: load('commands'),
  events: load('events'),
  components: [],
  dashboard,
  sanction,
  /** Registers the scheduler handlers before the scheduler arms stored jobs. */
  init(client, ctx) {
    registerJobs(ctx);
  }
};
