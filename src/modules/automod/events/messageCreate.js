'use strict';

const { Events } = require('discord.js');
const { handleMessage } = require('../lib/handler');

/** Runs every new guild message through the automod filters. */
module.exports = {
  event: Events.MessageCreate,
  execute: (ctx, message) => handleMessage(ctx, message)
};
