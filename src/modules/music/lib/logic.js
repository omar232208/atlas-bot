'use strict';

/**
 * Pure helpers of the music module (no Discord, no network), unit-tested in
 * test/music.test.js.
 */

const LOOP_MODES = ['off', 'track', 'queue'];

/**
 * Per-guild queue. `current` is the track being played; `tracks` holds the
 * upcoming ones. Loop modes decide what `next()` returns when a track ends.
 */
class Queue {
  constructor() {
    /** @type {object|null} */
    this.current = null;
    /** @type {object[]} */
    this.tracks = [];
    /** @type {'off'|'track'|'queue'} */
    this.loop = 'off';
  }

  /** Number of upcoming tracks (the current one is not counted). */
  get size() { return this.tracks.length; }

  /**
   * Adds tracks at the end, or right after the current one when `front` is true.
   * @param {object|object[]} items
   * @param {{front?: boolean}} [opts]
   * @returns {number} 1-based position of the first added track in the upcoming list.
   */
  add(items, opts = {}) {
    const list = Array.isArray(items) ? items : [items];
    if (opts.front) { this.tracks.unshift(...list); return 1; }
    this.tracks.push(...list);
    return this.tracks.length - list.length + 1;
  }

  /**
   * Advances the queue and returns the new current track (or null at the end).
   * A natural end keeps the same track in "track" loop; a skip always moves on.
   * In "queue" loop the finished track goes back to the end of the queue.
   * @param {{skip?: boolean}} [opts]
   */
  next(opts = {}) {
    if (this.current && this.loop === 'track' && !opts.skip) return this.current;
    if (this.current && this.loop === 'queue') this.tracks.push(this.current);
    this.current = this.tracks.shift() || null;
    return this.current;
  }

  /**
   * Jumps to the upcoming track at `position` (1-based). Tracks skipped over are
   * dropped, or recycled to the end in "queue" loop so nothing is lost.
   * @param {number} position
   * @returns {object|null} The new current track, or null if the position is invalid.
   */
  skipTo(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.tracks.length) return null;
    const skipped = this.tracks.splice(0, position - 1);
    if (this.loop === 'queue') this.tracks.push(...(this.current ? [this.current] : []), ...skipped);
    this.current = this.tracks.shift();
    return this.current;
  }

  /**
   * Fisher-Yates shuffle of the upcoming tracks.
   * @param {() => number} [rng] Random source in [0, 1), injectable for tests.
   */
  shuffle(rng = Math.random) {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
    return this.tracks.length;
  }

  /**
   * Moves an upcoming track. Positions are 1-based.
   * @returns {object|null} The moved track, or null when a position is out of range.
   */
  move(from, to) {
    const n = this.tracks.length;
    if (![from, to].every((p) => Number.isInteger(p) && p >= 1 && p <= n)) return null;
    const [track] = this.tracks.splice(from - 1, 1);
    this.tracks.splice(to - 1, 0, track);
    return track;
  }

  /**
   * Removes the upcoming track at a 1-based position.
   * @returns {object|null}
   */
  remove(position) {
    if (!Number.isInteger(position) || position < 1 || position > this.tracks.length) return null;
    return this.tracks.splice(position - 1, 1)[0];
  }

  /** Empties the upcoming list and returns how many tracks were removed. */
  clear() {
    const n = this.tracks.length;
    this.tracks = [];
    return n;
  }

  /** Forgets everything (used by /stop). */
  reset() {
    this.current = null;
    this.tracks = [];
    this.loop = 'off';
  }

  /** Sum of known durations of upcoming tracks, and whether some are unknown. */
  remainingDuration() {
    let total = 0;
    let unknown = false;
    for (const tr of this.tracks) {
      if (tr.live || !tr.durationMs) unknown = true;
      else total += tr.durationMs;
    }
    return { total, unknown };
  }
}

/**
 * Next loop mode for the "loop" button: off → track → queue → off.
 * @param {string} mode
 */
function cycleLoop(mode) {
  return LOOP_MODES[(LOOP_MODES.indexOf(mode) + 1) % LOOP_MODES.length];
}

/**
 * Parses a playback position: "90", "1:30", "01:02:03", "1m30s", "2h".
 * A leading "+" or "-" makes it relative (returned with `relative: true`).
 * @param {string} input
 * @returns {{ms: number, relative: boolean}|null}
 */
function parseTime(input) {
  if (input === undefined || input === null) return null;
  let text = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  let sign = 0;
  if (text[0] === '+' || text[0] === '-') { sign = text[0] === '-' ? -1 : 1; text = text.slice(1); }
  let seconds = null;
  if (/^\d+(\.\d+)?$/.test(text)) seconds = Number(text);
  else if (/^\d+(:[0-5]?\d){1,2}$/.test(text)) seconds = text.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
  else if (/^(\d+h)?(\d+m)?(\d+s)?$/.test(text) && text) {
    const [, h = '0', m = '0', s = '0'] = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const ms = Math.round(seconds * 1000);
  return { ms: sign ? sign * ms : ms, relative: sign !== 0 };
}

/**
 * Formats milliseconds as m:ss or h:mm:ss (the usual player clock).
 * @param {number} ms
 */
function formatTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Text progress bar, e.g. "▬▬▬▬●▬▬▬▬▬". Unknown or zero length gives an empty bar.
 * @param {number} position ms
 * @param {number} total ms
 * @param {number} [size] Number of cells.
 */
function progressBar(position, total, size = 18) {
  if (!total || total <= 0) return '▬'.repeat(size);
  const ratio = Math.min(1, Math.max(0, position / total));
  const idx = Math.min(size - 1, Math.floor(ratio * size));
  return '▬'.repeat(idx) + '●' + '▬'.repeat(size - idx - 1);
}

/**
 * Clamps a volume percentage to 0-150 (the range the ffmpeg filter is allowed).
 * @param {number} value
 */
function clampVolume(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 100;
  return Math.min(150, Math.max(0, n));
}

/**
 * True for IPv4/IPv6 literals that must never be fetched: loopback, private,
 * link-local, CGNAT, multicast, unspecified. Blocking them stops users from
 * making the bot probe the host's internal network (SSRF).
 * @param {string} ip
 */
function isPrivateAddress(ip) {
  const addr = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  // The URL parser rewrites ::ffff:127.0.0.1 as ::ffff:7f00:1: decode it back.
  const hex = addr.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (addr.includes(':')) {
    return addr === '::' || addr === '::1' || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || /^ff/.test(addr);
  }
  return false;
}

/**
 * Checks a user-supplied audio URL. Only http(s), no credentials, no local or
 * private hosts. DNS answers are checked again at connection time (source.js).
 * @param {string} input
 * @returns {{ok: true, url: URL}|{ok: false, reason: 'invalid'|'protocol'|'blocked'}}
 */
function validateUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { return { ok: false, reason: 'invalid' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'protocol' };
  if (url.username || url.password) return { ok: false, reason: 'invalid' };
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return { ok: false, reason: 'blocked' };
  if (isPrivateAddress(host)) return { ok: false, reason: 'blocked' };
  return { ok: true, url };
}

/**
 * Guesses what a URL points to from its path extension.
 * @param {string|URL} url
 * @returns {'playlist'|'audio'|'unknown'}
 */
function urlKind(url) {
  const path = (url instanceof URL ? url : new URL(url)).pathname.toLowerCase();
  if (/\.(m3u8?|pls)$/.test(path)) return 'playlist';
  if (/\.(mp3|ogg|oga|opus|flac|wav|m4a|aac|webm|mp4|wma|aiff?)$/.test(path)) return 'audio';
  return 'unknown';
}

/**
 * Readable title from a URL: decoded file name without extension, else host.
 * @param {string|URL} url
 */
function titleFromUrl(url) {
  const u = url instanceof URL ? url : new URL(url);
  let name = u.pathname.split('/').filter(Boolean).pop() || '';
  try { name = decodeURIComponent(name); } catch { /* keep raw name */ }
  name = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]+/g, ' ').trim();
  return (name || u.hostname).slice(0, 200);
}

/**
 * Parses an M3U or PLS playlist into entries. HLS (#EXT-X-) is detected so the
 * caller can refuse it: segmented streams cannot be piped as one file.
 * @param {string} text
 * @returns {{hls: boolean, entries: Array<{url: string, title?: string}>}}
 */
function parsePlaylist(text) {
  const body = String(text || '').replace(/^﻿/, '');
  if (/#EXT-X-/i.test(body)) return { hls: true, entries: [] };
  const entries = [];
  if (/^\s*\[playlist\]/im.test(body)) {
    const files = {};
    const titles = {};
    for (const line of body.split(/\r?\n/)) {
      const m = line.trim().match(/^(file|title)(\d+)\s*=\s*(.+)$/i);
      if (!m) continue;
      (m[1].toLowerCase() === 'file' ? files : titles)[m[2]] = m[3].trim();
    }
    for (const key of Object.keys(files).sort((a, b) => a - b)) entries.push({ url: files[key], title: titles[key] });
  } else {
    let title;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) { title = line.split(',').slice(1).join(',').trim() || undefined; continue; }
      if (line.startsWith('#')) continue;
      entries.push({ url: line, title });
      title = undefined;
    }
  }
  return { hls: false, entries: entries.filter((e) => /^https?:\/\//i.test(e.url)) };
}

/**
 * Extracts StreamTitle from an ICY metadata block ("StreamTitle='Artist - Song';").
 * @param {string} block
 * @returns {string|null}
 */
function parseIcyTitle(block) {
  const m = String(block).match(/StreamTitle='(.*?)';/s);
  const title = m?.[1]?.trim();
  return title ? title.slice(0, 200) : null;
}

/**
 * Reads duration and bitrate from ffmpeg's stderr banner.
 * @param {string} text
 * @returns {{durationMs: number|null, kbps: number|null}}
 */
function parseFfmpegInfo(text) {
  const d = String(text).match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const durationMs = d ? Math.round(((Number(d[1]) * 60 + Number(d[2])) * 60 + Number(d[3])) * 1000) : null;
  const b = String(text).match(/Audio:[^\n]*?(\d+) kb\/s/) || String(text).match(/bitrate:\s*(\d+) kb\/s/);
  return { durationMs: durationMs || null, kbps: b ? Number(b[1]) : null };
}

/**
 * Builds the ffmpeg arguments: read the piped input, optionally skip to `seekMs`,
 * apply the volume filter and encode Ogg/Opus at 48 kHz stereo for Discord.
 * @param {{seekMs?: number, volume?: number, live?: boolean}} opts
 * @returns {string[]}
 */
function ffmpegArgs(opts = {}) {
  const args = ['-hide_banner', '-nostats', '-loglevel', 'info'];
  // Live radios start faster with a small probe; files keep the default for accuracy.
  if (opts.live) args.push('-probesize', '64k', '-analyzeduration', '1000000');
  args.push('-i', 'pipe:0');
  // Output-side -ss: the input is a pipe, which cannot be seeked, and an input
  // -ss makes some demuxers (WAV) drop everything. Decoding and discarding the
  // skipped part is fast for audio (tens of times real time).
  if (opts.seekMs > 0 && !opts.live) args.push('-ss', (opts.seekMs / 1000).toFixed(3));
  args.push('-vn', '-map', '0:a:0?');
  const volume = clampVolume(opts.volume ?? 100);
  if (volume !== 100) args.push('-af', `volume=${(volume / 100).toFixed(2)}`);
  args.push('-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1');
  return args;
}

module.exports = {
  Queue, LOOP_MODES, cycleLoop, parseTime, formatTime, progressBar, clampVolume,
  isPrivateAddress, validateUrl, urlKind, titleFromUrl, parsePlaylist, parseIcyTitle,
  parseFfmpegInfo, ffmpegArgs
};
