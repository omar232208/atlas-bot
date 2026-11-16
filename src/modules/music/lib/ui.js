'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { t } = require('../../../core/i18n');
const embeds = require('../../../core/embeds');
const { formatTime, progressBar } = require('./logic');

/** Prefix of every button of this module (routed by the loader). */
const PREFIX = 'mus:';

const escape = (s) => String(s || '').replace(/([\\*_`~|[\]])/g, '\\$1');

/**
 * Markdown title of a track, linked when the URL is a public page or file.
 * @param {object} track
 */
function trackTitle(track) {
  const title = escape(track.title).slice(0, 180) || '?';
  return track.url && !track.kind?.startsWith('file') ? `[${title}](${track.url})` : title;
}

/**
 * Duration label: clock, "~clock" when estimated, live or unknown.
 * @param {*} lang
 * @param {object} track
 */
function durationLabel(lang, track) {
  if (track.live) return t(lang, 'music:ui.live');
  if (!track.durationMs) return t(lang, 'music:ui.unknownDuration');
  return `${track.estimated ? '~' : ''}${formatTime(track.durationMs)}`;
}

/**
 * One queue line: "`3.` [Title](url) · 3:20 · @user".
 * @param {*} lang
 * @param {object} track
 * @param {number} index 1-based
 */
function trackLine(lang, track, index) {
  return t(lang, 'music:ui.queueLine', { index, title: trackTitle(track), duration: durationLabel(lang, track), user: `<@${track.requesterId}>` });
}

/**
 * Button row: pause/resume, skip, stop, loop.
 * @param {*} lang
 * @param {import('./player').GuildPlayer} player
 * @param {boolean} [disabled]
 */
function controlsRow(lang, player, disabled = false) {
  const loop = player.queue.loop;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}pause`).setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel(t(lang, player.paused ? 'music:ui.buttons.resume' : 'music:ui.buttons.pause')).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${PREFIX}skip`).setStyle(ButtonStyle.Secondary).setLabel(t(lang, 'music:ui.buttons.skip')).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${PREFIX}stop`).setStyle(ButtonStyle.Danger).setLabel(t(lang, 'music:ui.buttons.stop')).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${PREFIX}loop`).setStyle(loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setLabel(t(lang, 'music:ui.buttons.loop', { mode: t(lang, `music:loopModes.${loop}`) })).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${PREFIX}refresh`).setStyle(ButtonStyle.Secondary).setLabel(t(lang, 'music:ui.buttons.refresh')).setDisabled(disabled)
  );
}

/**
 * Embed + controls showing the current track, its progress and player state.
 * @param {import('./player').GuildPlayer} player
 * @param {*} lang Language target.
 * @param {{compact?: boolean}} [opts] compact: announcement version, without progress.
 */
function nowPlayingPayload(player, lang, opts = {}) {
  const track = player.queue.current;
  if (!track) return { embeds: [embeds.info(t(lang, 'music:nowplaying.title'), t(lang, 'music:errors.nothingPlaying'))], components: [] };
  const lines = [`**${trackTitle(track)}**`];
  if (track.live && track.streamTitle) lines.push(t(lang, 'music:ui.onAir', { title: escape(track.streamTitle) }));
  if (!opts.compact) {
    const pos = player.position;
    lines.push('', track.live
      ? `${formatTime(pos)} · ${t(lang, 'music:ui.live')}`
      : `\`${formatTime(pos)}\` ${progressBar(pos, track.durationMs)} \`${durationLabel(lang, track)}\``);
  }
  const fields = [
    { name: t(lang, 'music:ui.requestedBy'), value: `<@${track.requesterId}>`, inline: true },
    { name: t(lang, 'music:ui.volume'), value: `${player.volume}%`, inline: true },
    { name: t(lang, 'music:ui.loop'), value: t(lang, `music:loopModes.${player.queue.loop}`), inline: true }
  ];
  if (opts.compact) fields.splice(1, 0, { name: t(lang, 'music:ui.duration'), value: durationLabel(lang, track), inline: true });
  const upNext = player.queue.tracks[0];
  fields.push({ name: t(lang, 'music:ui.upNext'), value: upNext ? `${trackTitle(upNext)} · ${t(lang, 'music:ui.inQueue', { count: player.queue.size })}` : t(lang, 'music:ui.queueEmpty') });
  const title = t(lang, player.paused ? 'music:nowplaying.pausedTitle' : 'music:nowplaying.title');
  const embed = embeds.base({ title, description: lines.join('\n'), fields });
  return { embeds: [embed], components: [controlsRow(lang, player)] };
}

/**
 * Pages of the queue (10 tracks each), current track and total on every page.
 * @param {import('./player').GuildPlayer} player
 * @param {*} lang
 * @returns {import('discord.js').EmbedBuilder[]}
 */
function queuePages(player, lang) {
  const { current, tracks, loop } = player.queue;
  const { total, unknown } = player.queue.remainingDuration();
  const header = current ? t(lang, 'music:queue.current', { title: trackTitle(current), duration: durationLabel(lang, current) }) : t(lang, 'music:errors.nothingPlaying');
  const summary = t(lang, 'music:queue.summary', {
    count: tracks.length,
    duration: `${unknown && total ? '+' : ''}${unknown && !total ? '?' : formatTime(total)}`,
    loop: t(lang, `music:loopModes.${loop}`)
  });
  const lines = tracks.map((tr, i) => trackLine(lang, tr, i + 1));
  const pages = [];
  for (let i = 0; i < Math.max(1, lines.length); i += 10) {
    const body = lines.slice(i, i + 10).join('\n') || t(lang, 'music:ui.queueEmpty');
    pages.push(embeds.base({ title: t(lang, 'music:queue.title'), description: `${header}\n\n${body}`.slice(0, 4000), footer: summary }));
  }
  return pages;
}

module.exports = { PREFIX, trackTitle, trackLine, durationLabel, controlsRow, nowPlayingPayload, queuePages, escape };
