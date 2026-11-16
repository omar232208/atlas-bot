'use strict';

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { PassThrough, Transform } = require('node:stream');
const { validateUrl, isPrivateAddress, urlKind, titleFromUrl, parsePlaylist, parseIcyTitle } = require('./logic');

// Node fetches the audio itself and pipes it into ffmpeg's stdin. ffmpeg-static
// is a fully static build whose DNS resolver crashes on many hosts (Docker,
// Alpine), so ffmpeg never opens network connections on its own. This also
// lets us filter private addresses, follow redirects safely and reconnect.
const USER_AGENT = 'AtlasBot/1.0';
const HEADER_TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 256 * 1024;
const PLAYLIST_TYPES = /mpegurl|scpls|pls\+xml|x-mpequrl/i;
const AUDIO_TYPES = /^(audio\/|video\/|application\/(ogg|octet-stream|x-flac|flac)|binary\/octet-stream)/i;

/** Error with a code mapped to music:errors.<code> in the locale files. */
class MusicError extends Error {
  /**
   * @param {string} code
   * @param {object} [vars] Interpolation values for the message.
   */
  constructor(code, vars = {}) {
    super(code);
    this.code = code;
    this.vars = vars;
  }
}

/**
 * dns.lookup replacement that refuses private and loopback answers, so even a
 * public hostname pointing to 127.0.0.1 (DNS rebinding) cannot reach the host.
 */
function safeLookup(hostname, options, callback) {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' && options ? options : {};
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      const blocked = new Error(`blocked address for ${hostname}`);
      blocked.code = 'EBLOCKED';
      return cb(blocked);
    }
    if (opts.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

const toMusicError = (err) => {
  if (err instanceof MusicError) return err;
  if (err?.code === 'EBLOCKED') return new MusicError('blocked');
  if (err?.code === 'ENOTFOUND' || err?.code === 'EAI_AGAIN') return new MusicError('dns');
  if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') return new MusicError('aborted');
  return new MusicError('network', { reason: err?.code || err?.message || 'unknown' });
};

/**
 * GET request following up to 5 redirects, each hop validated.
 * @param {string} target
 * @param {{headers?: object, signal?: AbortSignal}} [opts]
 * @returns {Promise<{res: import('node:http').IncomingMessage, url: URL}>}
 */
async function request(target, opts = {}) {
  let current = target;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = validateUrl(current);
    if (!check.ok) throw new MusicError(check.reason === 'blocked' ? 'blocked' : 'invalidUrl');
    const url = check.url;
    const lib = url.protocol === 'https:' ? https : http;
    const res = await new Promise((resolve, reject) => {
      const req = lib.get(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...opts.headers },
        lookup: safeLookup,
        signal: opts.signal,
        timeout: HEADER_TIMEOUT_MS
      }, resolve);
      req.on('timeout', () => req.destroy(new MusicError('timeout')));
      req.on('error', (err) => reject(toMusicError(err)));
    });
    // Once headers arrived, the socket must not time out between audio chunks.
    res.socket?.setTimeout(0);
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      current = new URL(res.headers.location, url).toString();
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      res.resume();
      throw new MusicError('http', { status: res.statusCode });
    }
    return { res, url };
  }
  throw new MusicError('redirects');
}

/** Reads at most `limit` bytes of a response as text. */
function readText(res, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { res.destroy(); return reject(new MusicError('playlistTooBig')); }
      parts.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    res.on('error', (err) => reject(toMusicError(err)));
  });
}

const isLiveResponse = (res) => !res.headers['content-length'] || Object.keys(res.headers).some((h) => h.startsWith('icy-'));

/**
 * Turns a user URL into one or more tracks without downloading the audio:
 * checks the status and type, expands M3U/PLS playlists, flags live streams.
 * @param {string} input
 * @param {{maxTracks?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<Array<{title: string, url: string, urls: string[], live: boolean, contentLength: number|null}>>}
 */
async function resolveUrl(input, opts = {}) {
  const check = validateUrl(input);
  if (!check.ok) throw new MusicError(check.reason === 'blocked' ? 'blocked' : check.reason === 'protocol' ? 'protocol' : 'invalidUrl');
  const { res, url } = await request(check.url.toString(), { signal: opts.signal, headers: { 'Icy-MetaData': '0' } });
  const type = String(res.headers['content-type'] || '').toLowerCase();
  // Many servers send .m3u/.pls as octet-stream or text/plain: trust the
  // extension unless the server clearly says it is audio.
  const playlist = PLAYLIST_TYPES.test(type) || (urlKind(url) === 'playlist' && !/^(audio|video)\//.test(type));
  if (playlist) {
    const parsed = parsePlaylist(await readText(res, MAX_PLAYLIST_BYTES));
    if (parsed.hls) throw new MusicError('hls');
    if (!parsed.entries.length) throw new MusicError('emptyPlaylist');
    // A PLS file (or a one-line M3U) is almost always a radio listing mirrors of
    // the same stream: keep them as fallbacks of a single track.
    if (/scpls|pls\+xml/.test(type) || /\.pls$/i.test(url.pathname) || parsed.entries.length === 1) {
      const first = parsed.entries[0];
      return [{ title: first.title || titleFromUrl(url), url: first.url, urls: parsed.entries.map((e) => e.url).slice(0, 5), live: true, contentLength: null }];
    }
    return parsed.entries.slice(0, opts.maxTracks || 100).map((e) => ({ title: e.title || titleFromUrl(e.url), url: e.url, urls: [e.url], live: false, contentLength: null }));
  }
  res.destroy();
  if (type && !AUDIO_TYPES.test(type)) throw new MusicError('notAudio', { type: type.split(';')[0] });
  const live = isLiveResponse(res);
  const icyName = typeof res.headers['icy-name'] === 'string' ? res.headers['icy-name'].trim() : '';
  return [{
    title: (live && icyName) ? icyName.slice(0, 200) : titleFromUrl(url),
    url: url.toString(),
    urls: [url.toString()],
    live,
    contentLength: Number(res.headers['content-length']) || null
  }];
}

/**
 * Removes ICY metadata blocks interleaved every `metaint` bytes in a radio
 * stream (they would be decoded as noise) and reports title changes.
 */
class IcyStripper extends Transform {
  /**
   * @param {number} metaint Audio bytes between two metadata blocks.
   * @param {(title: string) => void} [onTitle]
   */
  constructor(metaint, onTitle) {
    super();
    this.metaint = metaint;
    this.onTitle = onTitle;
    this.left = metaint;
    this.metaLeft = -1;
    this.meta = [];
  }

  _transform(chunk, _enc, done) {
    let i = 0;
    while (i < chunk.length) {
      if (this.metaLeft < 0 && this.left > 0) {
        const n = Math.min(this.left, chunk.length - i);
        this.push(chunk.subarray(i, i + n));
        this.left -= n;
        i += n;
      } else if (this.metaLeft < 0) {
        // Length byte: metadata size in 16-byte units (0 = no change).
        this.metaLeft = chunk[i++] * 16;
        if (this.metaLeft === 0) { this.metaLeft = -1; this.left = this.metaint; }
      } else {
        const n = Math.min(this.metaLeft, chunk.length - i);
        this.meta.push(chunk.subarray(i, i + n));
        this.metaLeft -= n;
        i += n;
        if (this.metaLeft === 0) {
          const raw = Buffer.concat(this.meta);
          // Many old Shoutcast servers send Latin-1: fall back when UTF-8 is invalid.
          let text = raw.toString('utf8');
          if (text.includes('\uFFFD')) text = raw.toString('latin1');
          const title = parseIcyTitle(text.replace(/\0+$/, ''));
          if (title && this.onTitle) this.onTitle(title);
          this.meta = [];
          this.metaLeft = -1;
          this.left = this.metaint;
        }
      }
    }
    done();
  }
}

const wait = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * Opens the audio bytes of a track as one continuous stream. Live streams are
 * reconnected (up to 5 failures in a row, mirrors tried in turn); files resume
 * with an HTTP Range request after a network cut when the server allows it.
 * Destroying the returned stream aborts the download.
 * @param {{url: string, urls?: string[], live?: boolean}} track
 * @param {{onTitle?: (title: string) => void, onFirstConnect?: () => void}} [opts]
 * @returns {PassThrough}
 */
function openAudio(track, opts = {}) {
  const out = new PassThrough({ highWaterMark: 64 * 1024 });
  const controller = new AbortController();
  const urls = track.urls?.length ? track.urls : [track.url];
  let received = 0;
  let failures = 0;
  let urlIndex = 0;
  let connectedOnce = false;
  let gen = 0;
  let currentRes = null;
  out.on('close', () => { controller.abort(); currentRes?.destroy(); });

  const connect = async () => {
    if (out.destroyed) return;
    // Each connection gets a generation number so late events of an old
    // response cannot trigger a second, parallel reconnection.
    const myGen = ++gen;
    const fail = (err) => { if (myGen === gen) retry(err); };
    const headers = {};
    if (track.live) headers['Icy-MetaData'] = '1';
    else if (received > 0) headers.Range = `bytes=${received}-`;
    let res;
    try {
      ({ res } = await request(urls[urlIndex], { headers, signal: controller.signal }));
    } catch (err) {
      return retry(err);
    }
    if (out.destroyed) return res.destroy();
    currentRes = res;
    if (!track.live && received > 0 && res.statusCode !== 206) {
      // The server ignored the Range header: replaying from the start would
      // repeat audio, so the track simply ends here.
      res.destroy();
      return out.end();
    }
    if (!connectedOnce) { connectedOnce = true; opts.onFirstConnect?.(); }
    const metaint = Number(res.headers['icy-metaint']);
    const src = track.live && metaint > 0 ? res.pipe(new IcyStripper(metaint, opts.onTitle)) : res;
    let sinceConnect = 0;
    src.on('data', (chunk) => {
      received += chunk.length;
      sinceConnect += chunk.length;
      // A healthy stream resets the failure counter, so long sessions survive cuts.
      if (sinceConnect > 256 * 1024) failures = 0;
      if (!out.write(chunk)) { src.pause(); out.once('drain', () => src.resume()); }
    });
    src.on('end', () => { if (myGen !== gen) return; if (track.live) fail(new MusicError('network', { reason: 'end' })); else out.end(); });
    res.on('error', fail);
    res.on('aborted', () => fail(new MusicError('network', { reason: 'aborted' })));
  };

  let retrying = false;
  const retry = async (err) => {
    if (out.destroyed || retrying || controller.signal.aborted) return;
    retrying = true;
    failures += 1;
    const max = track.live ? 5 : 3;
    if (failures > max || (!connectedOnce && failures > (track.live ? 2 : 1))) {
      retrying = false;
      return out.destroy(toMusicError(err));
    }
    if (track.live && urls.length > 1) urlIndex = (urlIndex + 1) % urls.length;
    await wait(Math.min(5000, 1000 * failures), controller.signal);
    retrying = false;
    connect();
  };

  connect();
  return out;
}

module.exports = { MusicError, request, resolveUrl, openAudio, IcyStripper, safeLookup, USER_AGENT };
