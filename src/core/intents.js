'use strict';

const { GatewayIntentBits, ApplicationFlags, REST, Routes } = require('discord.js');

/**
 * Gateway intents needed by all modules together. GuildPresences is left out on
 * purpose: no module needs it and it costs a lot of memory on big servers.
 */
const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildExpressions,
  GatewayIntentBits.GuildIntegrations,
  GatewayIntentBits.GuildWebhooks,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.MessageContent
];

/**
 * Privileged intents we use, with the application flags that mean "enabled"
 * (the *Limited flag is what verified bots under 100 servers get) and the
 * toggle name shown in the Developer Portal, which is English-only.
 */
const PRIVILEGED = {
  GuildMembers: { bit: GatewayIntentBits.GuildMembers, flags: [ApplicationFlags.GatewayGuildMembers, ApplicationFlags.GatewayGuildMembersLimited], portal: 'Server Members Intent' },
  MessageContent: { bit: GatewayIntentBits.MessageContent, flags: [ApplicationFlags.GatewayMessageContent, ApplicationFlags.GatewayMessageContentLimited], portal: 'Message Content Intent' }
};

/**
 * Names of privileged intents that the application flags do not allow.
 * @param {number} appFlags The "flags" field of GET /applications/@me.
 * @returns {string[]} Keys of PRIVILEGED.
 */
function missingPrivileged(appFlags) {
  const flags = Number(appFlags) || 0;
  return Object.keys(PRIVILEGED).filter((name) => !PRIVILEGED[name].flags.some((f) => (flags & f) === f));
}

/**
 * Removes the given privileged intents from the intent list.
 * @param {number[]} intents
 * @param {string[]} missing
 */
function withoutIntents(intents, missing) {
  const drop = new Set(missing.map((name) => PRIVILEGED[name].bit));
  return intents.filter((bit) => !drop.has(bit));
}

/**
 * Reads the application (id + flags) with the bot token before logging in, so
 * a disabled privileged intent can be explained and worked around instead of
 * failing the gateway connection.
 * @param {string} token
 * @returns {Promise<{id: string, flags: number}>} Throws the REST error (401 = bad token).
 */
async function fetchApplication(token) {
  const rest = new REST({ version: '10' }).setToken(token);
  const app = await rest.get(Routes.currentApplication());
  return { id: app.id, flags: app.flags ?? 0 };
}

/**
 * True for the errors discord.js raises when the gateway closes with 4014.
 * @param {Error} err
 */
function isDisallowedIntents(err) {
  return err?.code === 'DisallowedIntents' || err?.code === 4014 || /disallowed intents|privileged intent/i.test(err?.message || '');
}

module.exports = { INTENTS, PRIVILEGED, missingPrivileged, withoutIntents, fetchApplication, isDisallowedIntents };
