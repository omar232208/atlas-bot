'use strict';

/**
 * Built-in public web radios. Every station is a free, legal stream published
 * by the broadcaster itself for direct listening (no scraping). Each URL was
 * checked to stream audio with ffmpeg before being listed. Genre labels are
 * localized under music:genres.<genre>.
 * @type {Array<{id: string, name: string, genre: string, url: string, homepage: string}>}
 */
const RADIOS = [
  { id: 'paradise', name: 'Radio Paradise — Main Mix', genre: 'eclectic', url: 'https://stream.radioparadise.com/aac-128', homepage: 'https://radioparadise.com' },
  { id: 'paradise-mellow', name: 'Radio Paradise — Mellow Mix', genre: 'chill', url: 'https://stream.radioparadise.com/mellow-128', homepage: 'https://radioparadise.com' },
  { id: 'paradise-rock', name: 'Radio Paradise — Rock Mix', genre: 'rock', url: 'https://stream.radioparadise.com/rock-128', homepage: 'https://radioparadise.com' },
  { id: 'paradise-global', name: 'Radio Paradise — Global Mix', genre: 'world', url: 'https://stream.radioparadise.com/global-128', homepage: 'https://radioparadise.com' },
  { id: 'fip', name: 'FIP', genre: 'eclectic', url: 'https://icecast.radiofrance.fr/fip-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-jazz', name: 'FIP Jazz', genre: 'jazz', url: 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-rock', name: 'FIP Rock', genre: 'rock', url: 'https://icecast.radiofrance.fr/fiprock-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-electro', name: 'FIP Electro', genre: 'electronic', url: 'https://icecast.radiofrance.fr/fipelectro-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-world', name: 'FIP Monde', genre: 'world', url: 'https://icecast.radiofrance.fr/fipworld-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-hiphop', name: 'FIP Hip-Hop', genre: 'hiphop', url: 'https://icecast.radiofrance.fr/fiphiphop-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-metal', name: 'FIP Metal', genre: 'metal', url: 'https://icecast.radiofrance.fr/fipmetal-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-pop', name: 'FIP Pop', genre: 'pop', url: 'https://icecast.radiofrance.fr/fippop-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'fip-reggae', name: 'FIP Reggae', genre: 'reggae', url: 'https://icecast.radiofrance.fr/fipreggae-midfi.mp3', homepage: 'https://www.radiofrance.fr/fip' },
  { id: 'swiss-jazz', name: 'Radio Swiss Jazz', genre: 'jazz', url: 'https://stream.srg-ssr.ch/m/rsj/mp3_128', homepage: 'https://www.radioswissjazz.ch' },
  { id: 'swiss-classic', name: 'Radio Swiss Classic', genre: 'classical', url: 'https://stream.srg-ssr.ch/m/rsc_de/mp3_128', homepage: 'https://www.radioswissclassic.ch' },
  { id: 'swiss-pop', name: 'Radio Swiss Pop', genre: 'pop', url: 'https://stream.srg-ssr.ch/m/rsp/mp3_128', homepage: 'https://www.radioswisspop.ch' },
  { id: 'venice-classic', name: 'Venice Classic Radio', genre: 'classical', url: 'https://uk2.streamingpulse.com/ssl/vcr1', homepage: 'https://www.veniceclassicradio.eu' },
  { id: 'kexp', name: 'KEXP 90.3 Seattle', genre: 'indie', url: 'https://kexp.streamguys1.com/kexp160.aac', homepage: 'https://www.kexp.org' },
  { id: 'wfmu', name: 'WFMU Freeform Radio', genre: 'eclectic', url: 'https://stream0.wfmu.org/freeform-128k', homepage: 'https://wfmu.org' },
  { id: 'radio-meuh', name: 'Radio Meuh', genre: 'chill', url: 'https://radiomeuh.ice.infomaniak.ch/radiomeuh-128.mp3', homepage: 'https://www.radiomeuh.com' },
  { id: 'nightwave-plaza', name: 'Nightwave Plaza', genre: 'vaporwave', url: 'http://radio.plaza.one/mp3', homepage: 'https://plaza.one' },
  { id: 'nightride', name: 'Nightride FM', genre: 'synthwave', url: 'https://stream.nightride.fm/nightride.mp3', homepage: 'https://nightride.fm' },
  { id: 'nightride-chillsynth', name: 'Nightride FM — Chillsynth', genre: 'synthwave', url: 'https://stream.nightride.fm/chillsynth.mp3', homepage: 'https://nightride.fm' },
  { id: 'nightride-darksynth', name: 'Nightride FM — Darksynth', genre: 'synthwave', url: 'https://stream.nightride.fm/darksynth.mp3', homepage: 'https://nightride.fm' }
];

const GENRES = [...new Set(RADIOS.map((r) => r.genre))];

const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Finds a station by id or exact (case/accent-insensitive) name.
 * @param {string} query
 */
function findRadio(query) {
  const q = normalize(query);
  if (!q) return null;
  return RADIOS.find((r) => r.id === String(query).trim().toLowerCase() || normalize(r.name) === q || normalize(r.id) === q) || null;
}

/**
 * Stations matching a free-text query on name, id or genre (for autocomplete).
 * @param {string} query
 * @param {(genre: string) => string} [genreLabel] Localized genre name, also searched.
 * @returns {typeof RADIOS}
 */
function searchRadios(query, genreLabel = (g) => g) {
  const q = normalize(query);
  if (!q) return RADIOS.slice();
  return RADIOS.filter((r) => normalize(`${r.name} ${r.id} ${r.genre} ${genreLabel(r.genre)}`).includes(q));
}

module.exports = { RADIOS, GENRES, findRadio, searchRadios };
