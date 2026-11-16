'use strict';

let cached;

/**
 * Loads the optional voice dependencies once. They are optionalDependencies:
 * on a host where they could not be installed, the music module turns itself
 * off instead of crashing the bot.
 * @returns {{ok: true, voice: typeof import('@discordjs/voice'), ffmpegPath: string}|{ok: false, missing: string, error: Error}}
 */
function loadDeps() {
  if (cached) return cached;
  let current = '@discordjs/voice';
  try {
    const voice = require('@discordjs/voice');
    current = 'prism-media';
    require('prism-media');
    current = 'ffmpeg-static';
    const ffmpegPath = require('ffmpeg-static');
    if (!ffmpegPath || !require('node:fs').existsSync(ffmpegPath)) throw new Error('ffmpeg binary not found');
    cached = { ok: true, voice, ffmpegPath };
  } catch (error) {
    cached = { ok: false, missing: current, error };
  }
  return cached;
}

module.exports = { loadDeps };
