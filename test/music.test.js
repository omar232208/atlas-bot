'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');

const logic = require('../src/modules/music/lib/logic');
const { RADIOS, GENRES, findRadio, searchRadios } = require('../src/modules/music/lib/radios');
const { IcyStripper } = require('../src/modules/music/lib/source');
const { DEFAULTS, getConfig } = require('../src/modules/music/lib/config');
const { loadDeps } = require('../src/modules/music/lib/deps');
const music = require('../src/modules/music');
const { buildCommandJSON } = require('../src/core/registry');
const i18n = require('../src/core/i18n');

const LANGS = ['ar', 'en'];
const LOCALE_COUNT = new Set(Object.values(i18n.DISCORD_LOCALES).flat()).size;
const locale = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', lang, 'music.json'), 'utf8'));
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const track = (n, extra = {}) => ({ id: String(n), title: `t${n}`, requesterId: '1', ...extra });

test('queue: add, next and loop modes', () => {
  const q = new logic.Queue();
  assert.equal(q.add([track(1), track(2), track(3)]), 1);
  assert.equal(q.next().id, '1');
  q.loop = 'track';
  assert.equal(q.next().id, '1', 'track loop repeats on natural end');
  assert.equal(q.next({ skip: true }).id, '2', 'skip moves on even in track loop');
  q.loop = 'queue';
  assert.equal(q.next().id, '3');
  assert.deepEqual(q.tracks.map((t) => t.id), ['2']);
  assert.equal(q.next().id, '2');
  assert.equal(q.next().id, '3', 'queue loop cycles forever');
  q.loop = 'off';
  q.tracks = [];
  assert.equal(q.next(), null);
  assert.equal(q.add(track(9), { front: true }), 1);
});

test('queue: skipTo, move, remove, clear, shuffle', () => {
  const q = new logic.Queue();
  q.add([1, 2, 3, 4, 5].map((n) => track(n)));
  q.next();
  assert.equal(q.skipTo(0), null);
  assert.equal(q.skipTo(9), null);
  assert.equal(q.skipTo(3).id, '4');
  assert.deepEqual(q.tracks.map((t) => t.id), ['5']);

  q.add([6, 7, 8].map((n) => track(n)));
  assert.equal(q.move(1, 4).id, '5');
  assert.deepEqual(q.tracks.map((t) => t.id), ['6', '7', '8', '5']);
  assert.equal(q.move(0, 1), null);
  assert.equal(q.remove(2).id, '7');
  assert.equal(q.remove(10), null);

  let i = 0;
  const seq = [0.9, 0.1, 0.5];
  q.shuffle(() => seq[i++ % seq.length]);
  assert.deepEqual([...q.tracks.map((t) => t.id)].sort(), ['5', '6', '8']);
  assert.equal(q.clear(), 3);
  assert.equal(q.size, 0);

  const loopQ = new logic.Queue();
  loopQ.add([1, 2, 3].map((n) => track(n)));
  loopQ.next();
  loopQ.loop = 'queue';
  loopQ.skipTo(2);
  assert.deepEqual(loopQ.tracks.map((t) => t.id), ['1', '2'], 'queue loop keeps skipped tracks');
});

test('queue: remaining duration and loop cycle', () => {
  const q = new logic.Queue();
  q.add([track(1, { durationMs: 60000 }), track(2, { durationMs: 30000 }), track(3, { live: true })]);
  assert.deepEqual(q.remainingDuration(), { total: 90000, unknown: true });
  assert.equal(logic.cycleLoop('off'), 'track');
  assert.equal(logic.cycleLoop('track'), 'queue');
  assert.equal(logic.cycleLoop('queue'), 'off');
});

test('parseTime / formatTime / progressBar / clampVolume', () => {
  assert.deepEqual(logic.parseTime('90'), { ms: 90000, relative: false });
  assert.deepEqual(logic.parseTime('1:30'), { ms: 90000, relative: false });
  assert.deepEqual(logic.parseTime('01:02:03'), { ms: 3723000, relative: false });
  assert.deepEqual(logic.parseTime('2m10s'), { ms: 130000, relative: false });
  assert.deepEqual(logic.parseTime('1h'), { ms: 3600000, relative: false });
  assert.deepEqual(logic.parseTime('+30'), { ms: 30000, relative: true });
  assert.deepEqual(logic.parseTime('-10'), { ms: -10000, relative: true });
  for (const bad of ['', 'abc', '1:99', '1::2', null, '5x']) assert.equal(logic.parseTime(bad), null, String(bad));

  assert.equal(logic.formatTime(0), '0:00');
  assert.equal(logic.formatTime(65000), '1:05');
  assert.equal(logic.formatTime(3723000), '1:02:03');
  assert.equal(logic.formatTime(-5), '0:00');

  assert.equal(logic.progressBar(0, 100, 10), '●▬▬▬▬▬▬▬▬▬');
  assert.equal(logic.progressBar(50, 100, 10), '▬▬▬▬▬●▬▬▬▬');
  assert.equal(logic.progressBar(200, 100, 10), '▬▬▬▬▬▬▬▬▬●');
  assert.equal(logic.progressBar(10, 0, 5), '▬▬▬▬▬');
  assert.equal(logic.progressBar(10, 100).length, 18);

  assert.equal(logic.clampVolume(200), 150);
  assert.equal(logic.clampVolume(-3), 0);
  assert.equal(logic.clampVolume('abc'), 100);
});

test('URL validation blocks private networks and odd schemes', () => {
  assert.equal(logic.validateUrl('https://example.com/a.mp3').ok, true);
  assert.equal(logic.validateUrl('http://radio.example.org:8000/stream').ok, true);
  const reasons = {
    'ftp://example.com/a.mp3': 'protocol',
    'file:///etc/passwd': 'protocol',
    'not a url': 'invalid',
    'https://user:pass@example.com/a.mp3': 'invalid',
    'http://localhost:3000/a.mp3': 'blocked',
    'http://127.0.0.1/a.mp3': 'blocked',
    'http://10.1.2.3/a': 'blocked',
    'http://172.20.0.1/a': 'blocked',
    'http://192.168.1.1/a': 'blocked',
    'http://169.254.169.254/latest/meta-data': 'blocked',
    'http://100.64.0.1/a': 'blocked',
    'http://[::1]/a': 'blocked',
    'http://[fd00::1]/a': 'blocked',
    'http://[::ffff:127.0.0.1]/a': 'blocked',
    'http://printer.local/a': 'blocked'
  };
  for (const [url, reason] of Object.entries(reasons)) assert.deepEqual(logic.validateUrl(url), { ok: false, reason }, url);
  assert.equal(logic.isPrivateAddress('8.8.8.8'), false);
  assert.equal(logic.isPrivateAddress('2001:4860:4860::8888'), false);
  assert.equal(logic.isPrivateAddress('172.32.0.1'), false);
});

test('URL helpers: kind and title', () => {
  assert.equal(logic.urlKind('https://x.org/list.m3u'), 'playlist');
  assert.equal(logic.urlKind('https://x.org/radio.PLS'), 'playlist');
  assert.equal(logic.urlKind('https://x.org/song.flac?x=1'), 'audio');
  assert.equal(logic.urlKind('https://x.org/stream'), 'unknown');
  assert.equal(logic.titleFromUrl('https://x.org/music/My%20Song_live.mp3'), 'My Song live');
  assert.equal(logic.titleFromUrl('https://radio.example.org/'), 'radio.example.org');
});

test('playlist parsing: M3U, PLS and HLS detection', () => {
  const m3u = '#EXTM3U\n#EXTINF:123,Artist - One\nhttp://a.example/1.mp3\n\n# comment\nhttps://a.example/2.ogg\nrelative.mp3\n';
  assert.deepEqual(logic.parsePlaylist(m3u), { hls: false, entries: [{ url: 'http://a.example/1.mp3', title: 'Artist - One' }, { url: 'https://a.example/2.ogg', title: undefined }] });
  const pls = '[playlist]\nNumberOfEntries=2\nFile2=http://b.example/mirror\nFile1=http://b.example/main\nTitle1=Main\n';
  assert.deepEqual(logic.parsePlaylist(pls).entries.map((e) => e.url), ['http://b.example/main', 'http://b.example/mirror']);
  assert.equal(logic.parsePlaylist(pls).entries[0].title, 'Main');
  assert.equal(logic.parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:10\nseg1.ts').hls, true);
  assert.deepEqual(logic.parsePlaylist('').entries, []);
});

test('ICY metadata and ffmpeg banner parsing', () => {
  assert.equal(logic.parseIcyTitle("StreamTitle='Daft Punk - Veridis Quo';StreamUrl='';"), 'Daft Punk - Veridis Quo');
  assert.equal(logic.parseIcyTitle("StreamTitle='';"), null);
  const banner = 'Input #0, mp3, from \'pipe:0\':\n  Duration: 00:03:21.45, start: 0.000000, bitrate: 128 kb/s\n  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 128 kb/s';
  assert.deepEqual(logic.parseFfmpegInfo(banner), { durationMs: 201450, kbps: 128 });
  assert.deepEqual(logic.parseFfmpegInfo('Duration: N/A, start: 0, bitrate: 96 kb/s'), { durationMs: null, kbps: 96 });
});

test('ffmpeg arguments: seek, volume, live tuning', () => {
  const file = logic.ffmpegArgs({ seekMs: 90500, volume: 50 });
  assert.deepEqual(file.slice(file.indexOf('-ss'), file.indexOf('-ss') + 2), ['-ss', '90.500']);
  assert.ok(file.indexOf('-ss') > file.indexOf('-i'), '-ss after -i: pipes cannot be seeked');
  assert.deepEqual(file.slice(file.indexOf('-af'), file.indexOf('-af') + 2), ['-af', 'volume=0.50']);
  assert.equal(file.at(-1), 'pipe:1');
  assert.ok(file.includes('libopus') && file.includes('ogg'));
  const live = logic.ffmpegArgs({ seekMs: 5000, live: true });
  assert.ok(!live.includes('-ss'), 'no seek in live streams');
  assert.ok(!live.includes('-af'), 'no filter at 100 %');
  assert.ok(live.includes('-probesize'));
});

test('IcyStripper removes metadata blocks and reports titles', async () => {
  const meta = Buffer.from("StreamTitle='Song A';");
  const padded = Buffer.concat([meta, Buffer.alloc(Math.ceil(meta.length / 16) * 16 - meta.length)]);
  const audio1 = Buffer.alloc(8, 1);
  const audio2 = Buffer.alloc(8, 2);
  const stream = Buffer.concat([audio1, Buffer.from([padded.length / 16]), padded, audio2, Buffer.from([0]), Buffer.alloc(3, 3)]);
  const titles = [];
  const stripper = new IcyStripper(8, (t) => titles.push(t));
  const out = [];
  stripper.on('data', (c) => out.push(c));
  // Feed byte by byte to exercise block boundaries.
  for (const byte of stream) stripper.write(Buffer.from([byte]));
  stripper.end();
  await new Promise((r) => stripper.on('end', r));
  assert.deepEqual(Buffer.concat(out), Buffer.concat([audio1, audio2, Buffer.alloc(3, 3)]));
  assert.deepEqual(titles, ['Song A']);
});

test('built-in radios: valid, unique, searchable', () => {
  assert.ok(RADIOS.length >= 20 && RADIOS.length <= 25, 'about 20 stations, autocomplete shows 25 max');
  assert.equal(new Set(RADIOS.map((r) => r.id)).size, RADIOS.length);
  for (const r of RADIOS) {
    assert.match(r.id, /^[a-z0-9-]+$/);
    assert.ok(/^https?:\/\//.test(r.url) && logic.validateUrl(r.url).ok, r.url);
    assert.ok(r.homepage.startsWith('https://'), r.homepage);
  }
  assert.equal(findRadio('FIP Jazz').id, 'fip-jazz');
  assert.equal(findRadio('kexp').id, 'kexp');
  assert.equal(findRadio('nope'), null);
  assert.ok(searchRadios('synth').every((r) => r.genre === 'synthwave'));
  assert.ok(searchRadios('classique', (g) => (g === 'classical' ? 'Classique' : g)).length >= 2);
  for (const lang of LANGS) for (const g of GENRES) assert.ok(i18n.has(lang, `music:genres.${g}`), `${lang} genre ${g}`);
});

test('config defaults and bounds', () => {
  const data = {};
  const fake = { guild: () => ({ get: (p, d) => (p in data ? data[p] : d) }) };
  assert.deepEqual(getConfig(fake, '1'), { ...DEFAULTS });
  Object.assign(data, { 'music.maxQueue': 99999, 'music.defaultVolume': 400, 'music.stay247': true, 'music.djRole': '42' });
  const cfg = getConfig(fake, '1');
  assert.equal(cfg.maxQueue, 1000);
  assert.equal(cfg.defaultVolume, 150);
  assert.equal(cfg.stay247, true);
  assert.equal(cfg.djRole, '42');
});

test('module exports 12 valid commands and a dashboard schema', () => {
  assert.equal(music.name, 'music');
  assert.ok(Array.isArray(music.dashboard.sections) && music.dashboard.sections.length);
  if (!loadDeps().ok) {
    assert.equal(music.commands.length, 0, 'no command without voice dependencies');
    return;
  }
  const names = music.commands.map((c) => c.data.name).sort();
  assert.deepEqual(names, ['loop', 'music', 'nowplaying', 'pause', 'play', 'queue', 'radio', 'resume', 'seek', 'skip', 'stop', 'volume']);
  for (const cmd of music.commands) {
    const json = buildCommandJSON({ ...cmd, module: 'music' });
    assert.match(json.name, /^[a-z0-9_-]{1,32}$/);
    for (const lang of LANGS) assert.ok(i18n.has(lang, `music:commands.${json.name}.description`), `${lang} /${json.name}`);
    const walk = (opts) => {
      for (const o of opts || []) {
        assert.ok(o.description && o.description.length <= 100, `${json.name}.${o.name}`);
        for (const loc of Object.values(o.description_localizations || {})) assert.ok(loc.length <= 100, `${json.name}.${o.name}: ${loc}`);
        assert.equal(Object.keys(o.description_localizations || {}).length, LOCALE_COUNT, `${json.name}.${o.name} localized in every Discord locale`);
        walk(o.options);
      }
    };
    walk(json.options);
  }
  assert.equal(music.components[0].prefix, 'mus:');
});

test('dashboard fields use the config paths, defaults and locale keys', () => {
  const fields = music.dashboard.sections.flatMap((s) => s.fields);
  const types = new Set(['boolean', 'number', 'string', 'text', 'channel', 'role', 'channels', 'roles', 'select', 'list', 'duration']);
  for (const f of fields) {
    assert.ok(types.has(f.type), f.path);
    const key = f.path.replace(/^music\./, '');
    assert.ok(f.path.startsWith('music.') && key in DEFAULTS, f.path);
    assert.equal(f.default, DEFAULTS[key], `${f.path} default`);
    for (const lang of LANGS) for (const k of [f.label, f.help]) assert.ok(i18n.has(lang, k), `${lang} ${k}`);
  }
  assert.deepEqual(new Set(fields.map((f) => f.path.slice(6))), new Set(Object.keys(DEFAULTS)), 'every setting is editable');
  for (const s of music.dashboard.sections) for (const lang of LANGS) assert.ok(i18n.has(lang, s.title) && i18n.has(lang, s.description));
  for (const a of music.dashboard.actions) {
    assert.equal(typeof a.run, 'function');
    for (const lang of LANGS) assert.ok(i18n.has(lang, a.label));
  }
});

test('dashboard disconnect action without an active player', async () => {
  const key = await music.dashboard.actions[0].run({}, { id: '123' }, '1');
  for (const lang of LANGS) assert.ok(i18n.has(lang, key), key);
});

test('locale key parity across the 5 languages', () => {
  const ref = flatten(locale('ar')).sort();
  for (const lang of LANGS.slice(1)) assert.deepEqual(flatten(locale(lang)).sort(), ref, lang);
  const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  const fr = locale('ar');
  const get = (obj, k) => k.split('.').reduce((o, p) => o[p], obj);
  for (const lang of LANGS.slice(1)) {
    const data = locale(lang);
    for (const k of ref) assert.equal(placeholders(get(data, k)), placeholders(get(fr, k)), `${lang}:${k}`);
  }
});

test('ffmpeg-static transcodes piped audio to Ogg/Opus readable by the voice demuxer', { skip: !loadDeps().ok && 'voice dependencies not installed' }, async () => {
  const { ffmpegPath } = loadDeps();
  // 2 s sine wave as FLAC, generated by ffmpeg itself: no network needed.
  const wav = await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'flac', '-f', 'flac', 'pipe:1']);
    const parts = [];
    p.stdout.on('data', (c) => parts.push(c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(parts)) : reject(new Error(`ffmpeg exit ${code}`))));
  });
  const proc = spawn(ffmpegPath, logic.ffmpegArgs({ seekMs: 500, volume: 80 }));
  Readable.from([wav]).pipe(proc.stdin);
  const { opus } = require('prism-media');
  const demuxer = new opus.OggDemuxer();
  let packets = 0;
  let head = null;
  proc.stdout.on('data', (c) => { head = head || c.subarray(0, 4).toString(); });
  const ended = new Promise((r) => demuxer.on('end', r));
  proc.stdout.pipe(demuxer).on('data', () => { packets += 1; });
  const code = await new Promise((r) => proc.on('close', r));
  await ended;
  assert.equal(code, 0);
  assert.equal(head, 'OggS');
  // 20 ms Opus frames: 1.5 s left after the 0.5 s seek ≈ 75 packets.
  assert.ok(packets >= 70 && packets <= 80, `packets: ${packets}`);
});

test('a real WAV file can be piped with a seek (regression: input -ss dropped all audio)', { skip: !loadDeps().ok && 'voice dependencies not installed' }, async () => {
  const { ffmpegPath } = loadDeps();
  // 1 s, 48 kHz, mono, 16-bit sine with a complete RIFF header built here.
  const rate = 48000;
  const pcm = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  const proc = spawn(ffmpegPath, logic.ffmpegArgs({ seekMs: 250 }));
  proc.stdin.end(Buffer.concat([header, pcm]));
  let bytes = 0;
  let banner = '';
  proc.stdout.on('data', (c) => { bytes += c.length; });
  proc.stderr.on('data', (c) => { banner += c; });
  assert.equal(await new Promise((r) => proc.on('close', r)), 0);
  assert.ok(bytes > 5000, `ogg bytes: ${bytes}`);
  assert.equal(logic.parseFfmpegInfo(banner).kbps, 768, 'bitrate read from the banner for duration estimates');
});
