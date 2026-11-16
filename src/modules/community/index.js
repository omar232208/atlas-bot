'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { setup: setupBirthdays } = require('./lib/birthdays');
const { handleVote } = require('./lib/suggestionService');
const sticky = require('./lib/sticky');
const tags = require('./lib/tags');
const tempvoiceControls = require('./lib/tempvoiceControls');
const { PREFIX: SUGGESTION_PREFIX } = require('./lib/suggestions');
const { PREFIX: TEMPVOICE_PREFIX } = require('./lib/tempvoice');
const { dashboard } = require('./lib/dashboard');

const load = (dir) => fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.js')).sort().map((f) => require(path.join(__dirname, dir, f)));

/**
 * Community module: suggestions, starboard, birthdays, stats channels, sticky
 * messages, AFK, tags, temporary voice channels and auto-responder.
 */
module.exports = {
  name: 'community',
  commands: load('commands'),
  events: load('events'),
  components: [
    { prefix: SUGGESTION_PREFIX, execute: handleVote },
    { prefix: sticky.PREFIX, execute: sticky.handleModal },
    { prefix: tags.PREFIX, execute: tags.handleModal },
    { prefix: TEMPVOICE_PREFIX, execute: tempvoiceControls.handle }
  ],
  dashboard,
  /**
   * Registers the persistent hourly birthday job.
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    setupBirthdays(client, ctx);
  }
};
