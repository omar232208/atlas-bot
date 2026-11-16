'use strict';

const { Events } = require('discord.js');
const TV = require('../lib/tempvoice');

module.exports = {
  event: Events.VoiceStateUpdate,
  /**
   * @param {object} ctx
   * @param {import('discord.js').VoiceState} oldState
   * @param {import('discord.js').VoiceState} newState
   */
  async execute(ctx, oldState, newState) {
    await TV.onVoice(ctx, oldState, newState);
  }
};
