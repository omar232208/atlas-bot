'use strict';

const https = require('node:https');

/*
 * YouTube search via the public Innertube API (no key required).
 * The ANDROID client returns direct googlevideo URLs that the existing
 * HTTP→ffmpeg pipeline can stream without signature deciphering.
 */

const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const CLIENTS = [
  { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11' },
  { clientName: 'WEB', clientVersion: '2.20240726.00.00', clientScreen: 'EMBED' }
];

function post(path, body, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.youtube.com',
      path: `/youtubei/v1/${path}?key=${API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11)' },
      timeout: timeoutMs
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(new Error('bad json')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const walk = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if (node.videoRenderer) out.push(node.videoRenderer);
  if (node.videoWithContextRenderer) out.push(node.videoWithContextRenderer);
  if (node.compactVideoRenderer) out.push(node.compactVideoRenderer);
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, out);
  return out;
};

/** Top search results: [{id, title, author, durationMs}]. */
async function search(query, limit = 5) {
  const body = { context: { client: CLIENTS[0] }, query: String(query).slice(0, 200) };
  const data = await post('search', body);
  const seen = new Set();
  const results = [];
  for (const v of walk(data?.contents)) {
    const id = v.videoId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    results.push({
      id,
      title: (v.title?.runs?.[0]?.text || v.title?.simpleText || '').slice(0, 200),
      author: (v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '').slice(0, 100),
      durationMs: v.lengthText?.simpleText ? parseDuration(v.lengthText.simpleText) : null
    });
    if (results.length >= limit) break;
  }
  return results.filter((r) => r.title);
}

function parseDuration(text) {
  const parts = String(text).trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
}

/** Direct audio/video stream URL for a video id (first playable client wins). */
async function streamUrl(videoId) {
  for (const client of CLIENTS) {
    try {
      const body = { context: { client }, videoId };
      const data = await post('player', body);
      const formats = [
        ...(data?.streamingData?.adaptiveFormats || []),
        ...(data?.streamingData?.formats || [])
      ];
      // Prefer audio-only webm/opus, then any audio, then progressive mp4.
      const audio = formats.filter((f) => f.url && /audio\//.test(f.mimeType || ''))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const pick = audio[0] || formats.find((f) => f.url && /video\//.test(f.mimeType || ''));
      if (pick?.url) return { url: pick.url, mimeType: pick.mimeType, bitrate: pick.bitrate || null };
    } catch { /* try next client */ }
  }
  return null;
}

/**
 * Resolves free text ("song name - artist") to a playable track.
 * @returns {Promise<{title: string, url: string, durationMs: number|null, author: string}>}
 */
async function resolveQuery(query) {
  const results = await search(query, 1);
  if (!results.length) throw new Error('noResults');
  const top = results[0];
  const stream = await streamUrl(top.id);
  if (!stream) throw new Error('noStream');
  return {
    title: top.title,
    url: `https://www.youtube.com/watch?v=${top.id}`,
    streamUrl: stream.url,
    author: top.author,
    durationMs: top.durationMs,
    kind: 'youtube',
    live: false
  };
}

module.exports = { search, streamUrl, resolveQuery };
