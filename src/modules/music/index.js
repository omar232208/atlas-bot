'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, GatewayIntentBits } = require('discord.js');
const { loadDeps } = require('./lib/deps');
const { DEFAULTS, LIMITS } = require('./lib/config');

/**
 * Settings shown by the web dashboard. Paths and defaults are the ones read by
 * lib/config.js, so a change made there applies to the next command at once.
 * Exported even when the voice dependencies are missing, so settings can be
 * prepared before they are installed.
 */
const dashboard = {
  sections: [
    {
      id: 'controls',
      title: 'music:dashboard.controls.title',
      description: 'music:dashboard.controls.description',
      fields: [
        { path: 'music.djRole', type: 'role', label: 'music:dashboard.fields.djRole.label', help: 'music:dashboard.fields.djRole.help', default: DEFAULTS.djRole },
        { path: 'music.maxQueue', type: 'number', label: 'music:dashboard.fields.maxQueue.label', help: 'music:dashboard.fields.maxQueue.help', default: DEFAULTS.maxQueue, min: LIMITS.maxQueue.min, max: LIMITS.maxQueue.max },
        { path: 'music.defaultVolume', type: 'number', label: 'music:dashboard.fields.defaultVolume.label', help: 'music:dashboard.fields.defaultVolume.help', default: DEFAULTS.defaultVolume, min: LIMITS.defaultVolume.min, max: LIMITS.defaultVolume.max },
        { path: 'music.allowFiles', type: 'boolean', label: 'music:dashboard.fields.allowFiles.label', help: 'music:dashboard.fields.allowFiles.help', default: DEFAULTS.allowFiles }
      ]
    },
    {
      id: 'presence',
      title: 'music:dashboard.presence.title',
      description: 'music:dashboard.presence.description',
      fields: [
        { path: 'music.stay247', type: 'boolean', label: 'music:dashboard.fields.stay247.label', help: 'music:dashboard.fields.stay247.help', default: DEFAULTS.stay247 },
        { path: 'music.announce', type: 'boolean', label: 'music:dashboard.fields.announce.label', help: 'music:dashboard.fields.announce.help', default: DEFAULTS.announce },
        { path: 'music.announceChannel', type: 'channel', label: 'music:dashboard.fields.announceChannel.label', help: 'music:dashboard.fields.announceChannel.help', default: DEFAULTS.announceChannel, channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice] }
      ]
    }
  ],
  actions: [
    {
      id: 'disconnect',
      label: 'music:dashboard.actions.disconnect.label',
      danger: true,
      /** Stops the music and leaves the voice channel of the guild. */
      run: async (_ctx, guild) => {
        if (!loadDeps().ok) return 'music:dashboard.actions.unavailable';
        const player = require('./lib/runtime').getPlayer(guild.id);
        if (!player) return 'music:dashboard.actions.disconnect.notConnected';
        player.destroy();
        return 'music:dashboard.actions.disconnect.done';
      }
    }
  ]
};

const deps = loadDeps();

const loadDir = (dir) => fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.js')).sort().map((f) => require(path.join(__dirname, dir, f)));

/**
 * Music module. Without @discordjs/voice / prism-media / ffmpeg-static it
 * registers no command and explains why in the console at startup.
 */
module.exports = {
  name: 'music',
  dashboard,
  commands: deps.ok ? loadDir('commands') : [],
  events: deps.ok ? loadDir('events') : [],
  components: deps.ok ? [require('./lib/buttons').controls] : [],
  /**
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    // Console messages use the default language (empty target).
    if (!deps.ok) {
      ctx.logger.warn(ctx.t('', 'music:console.disabled', { dependency: deps.missing, reason: deps.error?.message || '' }));
      return;
    }
    const intents = client.options?.intents;
    if (intents && typeof intents.has === 'function' && !intents.has(GatewayIntentBits.GuildVoiceStates)) {
      ctx.logger.warn(ctx.t('', 'music:console.noVoiceIntent'));
    }
    const runtime = require('./lib/runtime');
    // ffmpeg children must not outlive the bot process.
    process.once('exit', () => runtime.destroyAll());
  }
};
