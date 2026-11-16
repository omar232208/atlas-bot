'use strict';

const { PermissionFlagsBits, MessageFlags, DiscordAPIError } = require('discord.js');
const { loadDeps } = require('./deps');
const { GuildPlayer } = require('./player');
const { MusicError } = require('./source');
const { getConfig } = require('./config');

const players = new Map();
let shared = null;

/**
 * Returns the player of a guild, or null when the bot is not playing there.
 * @param {string} guildId
 * @returns {GuildPlayer|null}
 */
function getPlayer(guildId) {
  return players.get(guildId) || null;
}

/**
 * Returns the guild's player, creating it on first use.
 * @param {import('discord.js').Guild} guild
 * @param {object} ctx
 * @returns {GuildPlayer}
 */
function obtainPlayer(guild, ctx) {
  let player = players.get(guild.id);
  if (player && !player.destroyed) return player;
  const deps = loadDeps();
  if (!deps.ok) throw new MusicError('unavailable');
  shared = shared || { voice: deps.voice, ffmpegPath: deps.ffmpegPath, ctx, onDestroy: (id) => players.delete(id) };
  player = new GuildPlayer(shared, guild);
  players.set(guild.id, player);
  return player;
}

/** Stops every player (process exit). */
function destroyAll() {
  for (const player of [...players.values()]) player.destroy({ keepSession: true });
}

/** All active players (used by events and the dashboard action). */
const allPlayers = () => [...players.values()];

/**
 * Whether a member may use destructive controls: always when no DJ role is
 * configured; otherwise DJ role, Manage Server, or being the only listener.
 * @param {import('discord.js').GuildMember} member
 * @param {{djRole: string|null}} cfg
 */
function isDJ(member, cfg) {
  if (!cfg.djRole) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.roles?.cache?.has(cfg.djRole)) return true;
  const channel = member.voice?.channel;
  return !!channel && channel.members.filter((m) => !m.user.bot).size === 1;
}

/**
 * Validates the caller's situation before a music command and returns what the
 * command needs. Throws a MusicError (answered by handleError) otherwise.
 * @param {import('discord.js').ChatInputCommandInteraction|import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 * @param {{voice?: boolean, playing?: boolean, dj?: boolean, ownTrack?: object}} [opts]
 *   voice: caller must be in the bot's channel; playing: a track must be loaded;
 *   dj: DJ rights required, unless the caller requested `ownTrack`.
 * @returns {{player: GuildPlayer|null, cfg: ReturnType<typeof getConfig>, member: import('discord.js').GuildMember}}
 */
function guard(interaction, ctx, opts = {}) {
  const member = interaction.member;
  const cfg = getConfig(ctx.store, interaction.guildId);
  const player = getPlayer(interaction.guildId);
  if (opts.voice !== false) {
    const channel = member?.voice?.channel;
    if (!channel) throw new MusicError('notInVoice');
    if (player?.channelId && player.channelId !== channel.id) throw new MusicError('sameChannel', { channel: `<#${player.channelId}>` });
  }
  if (opts.playing && !player?.queue.current) throw new MusicError('nothingPlaying');
  if (opts.dj && !isDJ(member, cfg)) {
    const own = opts.ownTrack && opts.ownTrack.requesterId === member.id;
    if (!own) throw new MusicError('djOnly', { role: `<@&${cfg.djRole}>` });
  }
  return { player, cfg, member };
}

/**
 * Joins the caller's voice channel (checking the bot's permissions first) and
 * returns the guild player.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} ctx
 */
async function ensureConnected(interaction, ctx) {
  const channel = interaction.member?.voice?.channel;
  if (!channel) throw new MusicError('notInVoice');
  const me = interaction.guild.members.me;
  const perms = channel.permissionsFor(me);
  const needed = ['ViewChannel', 'Connect', 'Speak'];
  const missing = needed.filter((p) => !perms?.has(PermissionFlagsBits[p]));
  if (missing.length) {
    throw new MusicError('botMissing', { channel: `<#${channel.id}>`, perms: missing.map((p) => ctx.permissions.permissionLabel(interaction, p)).join(', ') });
  }
  if (!channel.joinable) throw new MusicError('channelFull', { channel: `<#${channel.id}>` });
  const player = obtainPlayer(interaction.guild, ctx);
  player.lastTextChannelId = interaction.channelId;
  await player.connect(channel);
  return player;
}

/**
 * Sends or edits the command answer depending on whether it was deferred.
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {object} payload
 * @param {boolean} [ephemeral]
 */
function respond(interaction, payload, ephemeral = false) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
}

/**
 * Answers a failed music action with a localized error embed.
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {object} ctx
 * @param {Error} err
 */
async function handleError(interaction, ctx, err) {
  let description;
  if (err instanceof MusicError) description = ctx.t(interaction, `music:errors.${err.code}`, err.vars);
  else if (err instanceof DiscordAPIError && err.code === 50013) description = ctx.t(interaction, 'music:errors.discordPermissions');
  else {
    ctx.logger.error('[music] command failed:', err);
    description = ctx.t(interaction, 'music:errors.unexpected');
  }
  const payload = { embeds: [ctx.embeds.error(ctx.t(interaction, 'music:errors.title'), description)], components: [] };
  await respond(interaction, payload, true).catch(() => {});
}

/**
 * Wraps a command/button handler so every MusicError becomes a clean reply.
 * @param {(interaction: any, ctx: object) => Promise<any>} fn
 */
const safe = (fn) => async (interaction, ctx) => {
  try {
    return await fn(interaction, ctx);
  } catch (err) {
    return handleError(interaction, ctx, err);
  }
};

module.exports = { getPlayer, obtainPlayer, destroyAll, allPlayers, isDJ, guard, ensureConnected, respond, handleError, safe };
