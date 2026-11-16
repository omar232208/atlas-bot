'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe } = require('../lib/runtime');
const { enqueueAndPlay } = require('../lib/enqueue');
const { resolveUrl, MusicError } = require('../lib/source');
const { findRadio } = require('../lib/radios');
const ytsearch = require('../lib/ytsearch');
const { getConfig } = require('../lib/config');
const { radioAutocomplete } = require('./radio');

const AUDIO_FILE = /^(audio\/|video\/|application\/ogg)/i;

/** /play: a direct audio URL, an M3U/PLS playlist, a radio name or an attached file. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song name, audio URL, radio or file')
    .addStringOption((o) => o.setName('url').setDescription('Song name, audio URL, playlist or radio name').setMaxLength(1000).setAutocomplete(true))
    .addAttachmentOption((o) => o.setName('file').setDescription('Audio file to play'))
    .addBooleanOption((o) => o.setName('next').setDescription('Play right after the current track')),
  cooldown: 3,
  autocomplete: radioAutocomplete,
  execute: safe(async (interaction, ctx) => {
    const input = interaction.options.getString('url')?.trim();
    const file = interaction.options.getAttachment('file');
    const front = interaction.options.getBoolean('next') === true;
    if (!input && !file) throw new MusicError('playUsage');

    if (file) {
      if (!getConfig(ctx.store, interaction.guildId).allowFiles) throw new MusicError('filesDisabled');
      if (!AUDIO_FILE.test(file.contentType || '')) throw new MusicError('notAudioFile', { name: file.name });
      return enqueueAndPlay(interaction, ctx, async () => [{
        title: file.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').slice(0, 200) || file.name,
        url: file.url,
        live: false,
        // Discord only knows the duration of voice messages.
        durationMs: file.duration ? Math.round(file.duration * 1000) : null,
        contentLength: file.size,
        kind: 'file'
      }], { front });
    }

    if (!/^https?:\/\//i.test(input)) {
      const radio = findRadio(input);
      if (radio) return enqueueAndPlay(interaction, ctx, async () => [{ title: radio.name, url: radio.url, live: true, kind: 'radio', radioId: radio.id }], { front });
      // Free text is treated as a YouTube search: the top result plays.
      let yt;
      try {
        yt = await ytsearch.resolveQuery(input);
      } catch (err) {
        throw new MusicError(err.message === 'noResults' ? 'noResults' : 'searchFailed');
      }
      return enqueueAndPlay(interaction, ctx, async () => [{
        title: yt.title,
        url: yt.url,
        urls: [yt.streamUrl],
        live: false,
        durationMs: yt.durationMs,
        kind: 'youtube'
      }], { front });
    }
    const limit = getConfig(ctx.store, interaction.guildId).maxQueue;
    return enqueueAndPlay(interaction, ctx, async () => (await resolveUrl(input, { maxTracks: limit })).map((tr) => ({ ...tr, kind: 'url' })), { front });
  })
};
