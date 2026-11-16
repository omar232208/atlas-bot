'use strict';

const {
  CommandInteraction, DMChannel, Message, MessageComponentInteraction,
  ModalSubmitInteraction, NewsChannel, PartialGroupDMChannel, StageChannel,
  TextChannel, ThreadChannel, VoiceChannel
} = require('discord.js');
const { getCommand } = require('./command-registry');
const embeds = require('./embeds');

/*
 * Embed pipeline: every embed the bot sends passes through here once, so the
 * whole bot shares the Atlas design system. Guilds customise colours, footer,
 * author, branding and timestamps from the dashboard (Embeds module) and the
 * overrides are applied at the last moment — no call site needs to know.
 *
 * Payloads flagged `_keepEmbeds: true` skip styling (used by /embed, whose
 * whole purpose is building custom embeds). Buttons, files, polls, flags and
 * mentions are always preserved. Plain `content` strings are untouched, so
 * short conversational replies stay text exactly as authored.
 */

// Protection replies keep their hand-built embeds untouched: alerts,
// verification flow and every slash/component answer of commands in the
// "protection" category.
const KEEP_EMBED_CATEGORIES = new Set(['protection']);
const KEEP_CUSTOM_PREFIXES = ['vrf:'];

/** True when the sending interaction belongs to a keep-embed surface. */
function keepsEmbeds(sender) {
  if (!sender || typeof sender !== 'object') return false;
  const name = sender.commandName || sender.command?.name;
  if (name) {
    const cmd = getCommand(name);
    if (cmd && KEEP_EMBED_CATEGORIES.has(cmd.category)) return true;
  }
  const cid = sender.customId;
  return typeof cid === 'string' && KEEP_CUSTOM_PREFIXES.some((p) => cid.startsWith(p));
}

/** EmbedBuilder exposes `.data`; a raw APIEmbed is used as-is. */
function embedData(embed) {
  if (!embed || typeof embed !== 'object') return null;
  return embed.data || (typeof embed.toJSON === 'function' ? embed.toJSON() : embed);
}

const EMBED_KEYS = ['title', 'description', 'fields', 'footer', 'image', 'thumbnail', 'author', 'provider', 'video', 'color'];

/** True when the payload itself is an embed rather than a send options object. */
function isBareEmbed(payload) {
  if (payload.embeds || payload.content !== undefined || payload.components || payload.files || payload.flags !== undefined || payload.allowedMentions || payload.poll) return false;
  return EMBED_KEYS.some((k) => payload[k] !== undefined) || !!payload.data;
}

/** Guild id behind a send/reply target (interaction, channel or message). */
function guildIdOf(sender) {
  return sender?.guildId || sender?.guild?.id || sender?.channel?.guildId || sender?.channel?.guild?.id || sender?.message?.guildId || null;
}

/**
 * Rewrites a send/reply/edit payload so every embed is restyled with the
 * guild's Atlas customisation. Returns the payload untouched when there is
 * nothing embed-shaped inside.
 * @param {*} payload
 * @param {*} [sender] The object the method was called on (interaction, channel...).
 */
function toPlainPayload(payload, sender) {
  if (payload === null || payload === undefined || typeof payload !== 'object') return payload;

  if (payload._keepEmbeds === true || keepsEmbeds(sender)) {
    const { _keepEmbeds, ...rest } = payload;
    return rest;
  }

  const guildId = guildIdOf(sender);
  const styleOne = (embed) => {
    const data = embedData(embed);
    if (!data || typeof data !== 'object') return embed;
    return embeds.style(data, guildId, embeds.kindOf(embed));
  };

  if (Array.isArray(payload.embeds) && payload.embeds.length) {
    const { embeds: list, ...rest } = payload;
    return { ...rest, embeds: list.map(styleOne) };
  }

  if (isBareEmbed(payload)) {
    const { _keepEmbeds, ...bare } = payload;
    return { embeds: [styleOne(bare)] };
  }

  return payload;
}

/** Wraps a prototype method so its first argument passes through toPlainPayload. */
function wrapMethod(proto, name) {
  const orig = proto && proto[name];
  if (typeof orig !== 'function' || orig.__plainText) return;
  const wrapped = function (payload, ...args) {
    return orig.call(this, toPlainPayload(payload, this), ...args);
  };
  wrapped.__plainText = true;
  proto[name] = wrapped;
}

let patched = false;

/**
 * Installs the embed pipeline on every outbound path once:
 * channel.send (text, news, threads, DMs, voice), Message#edit and the
 * reply/followUp/editReply/update methods of every interaction type.
 */
function patchMessaging() {
  if (patched) return;
  patched = true;

  for (const cls of [TextChannel, NewsChannel, ThreadChannel, DMChannel, PartialGroupDMChannel, VoiceChannel, StageChannel]) {
    if (cls) wrapMethod(cls.prototype, 'send');
  }
  wrapMethod(Message.prototype, 'edit');

  for (const cls of [CommandInteraction, MessageComponentInteraction, ModalSubmitInteraction]) {
    if (!cls) continue;
    for (const name of ['reply', 'followUp', 'editReply', 'update']) wrapMethod(cls.prototype, name);
  }
}

module.exports = { patchMessaging, toPlainPayload, embedData, guildIdOf };
