'use strict';

const MAX_BODY = 64 * 1024;
const COOKIE = 'acl_sid';
const STATE_COOKIE = 'acl_oauth';

/**
 * Whether forwarded headers (X-Forwarded-*) are trusted. Default true because the
 * usual host (ACLClouds, Traefik) terminates HTTPS in front of the bot.
 */
const trustProxy = () => !/^(0|false|no|off)$/i.test(process.env.TRUST_PROXY || process.env.DASHBOARD_TRUST_PROXY || 'true');

/**
 * Headers sent on every response. The CSP forbids inline scripts and styles:
 * the UI only loads /app.js and /style.css from this origin.
 * @param {boolean} https
 */
function securityHeaders(https) {
  const h = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.discordapp.com data:; connect-src 'self'; font-src 'self'; form-action 'self' https://discord.com; frame-ancestors 'none'; base-uri 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // The login token travels in the URL: never leak it through Referer.
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
  };
  if (https) h['Strict-Transport-Security'] = 'max-age=15552000';
  return h;
}

/** True when the browser reached us over HTTPS (directly or through a trusted proxy). */
function isHttps(req) {
  if (req.socket?.encrypted) return true;
  return trustProxy() && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/**
 * Client IP for rate limiting. Behind a trusted proxy, the right-most
 * X-Forwarded-For entry is the one the proxy added (left ones are client-controlled).
 */
function clientIp(req) {
  if (trustProxy() && req.headers['x-forwarded-for']) {
    const parts = String(req.headers['x-forwarded-for']).split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

/** Parses the Cookie header. */
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    if (!(k in out)) out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Builds a Set-Cookie value.
 * @param {string} name
 * @param {string} value
 * @param {{maxAge: number, secure: boolean}} opts maxAge in seconds (0 deletes)
 */
function cookie(name, value, opts) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${opts.maxAge}${opts.secure ? '; Secure' : ''}`;
}

/**
 * Reads a JSON body with a size limit. Rejects non-JSON content types, which
 * also stops classic cross-site HTML form posts.
 * @returns {Promise<object>}
 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.toLowerCase().startsWith('application/json')) return reject(Object.assign(new Error('badType'), { status: 415 }));
    if (Number(req.headers['content-length'] || 0) > MAX_BODY) return reject(Object.assign(new Error('tooLarge'), { status: 413 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('tooLarge'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      if (!size) return resolve({});
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
        resolve(data);
      } catch {
        reject(Object.assign(new Error('badJson'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Public base URL: DASHBOARD_URL, otherwise learned once from the first request
 * that came through the proxy (X-Forwarded-Host) and persisted in store.global().
 * @param {object} store
 */
function createPublicUrl(store) {
  const clean = (u) => String(u).trim().replace(/\/+$/, '');
  const configured = () => (process.env.DASHBOARD_URL && /^https?:\/\/[^\s/]+/i.test(process.env.DASHBOARD_URL) ? clean(process.env.DASHBOARD_URL) : null);
  const get = () => configured() || store.global().get('dashboard.publicUrl', null);

  /** Learns the URL from forwarded headers; ignores IPs and localhost (probes, local tests). */
  const learn = (req) => {
    if (get() || !trustProxy()) return null;
    const host = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim().toLowerCase();
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    if (!host || !['http', 'https'].includes(proto)) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(host)) return null;
    const bare = host.replace(/:\d+$/, '');
    if (/^[\d.]+$/.test(bare) || bare === 'localhost' || bare.endsWith('.localhost')) return null;
    const url = `${proto}://${host}`;
    store.global().set('dashboard.publicUrl', url);
    return url;
  };

  return { get, learn, configured };
}

module.exports = { securityHeaders, isHttps, clientIp, parseCookies, cookie, readJson, createPublicUrl, trustProxy, MAX_BODY, COOKIE, STATE_COOKIE };
