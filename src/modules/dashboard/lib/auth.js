'use strict';

const crypto = require('node:crypto');

const SESSION_TTL = 7 * 24 * 3600 * 1000;
const LINK_TTL = 10 * 60 * 1000;
const STATE_TTL = 10 * 60 * 1000;
const MAX_SESSIONS = 2000;
const STORE_PATH = 'dashboard.sessions';

const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
// Only hashes are kept (memory and disk), so a leaked data file or heap dump
// does not hand out usable session ids or magic links.
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('base64url');

/**
 * Constant-time string comparison (false for different lengths or non-strings).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * Returns the HMAC secret: DASHBOARD_SECRET if set, otherwise a random secret
 * generated once and kept in the global store so sessions survive restarts.
 * @param {object} store
 * @returns {string}
 */
function loadSecret(store) {
  if (process.env.DASHBOARD_SECRET && process.env.DASHBOARD_SECRET.length >= 16) return process.env.DASHBOARD_SECRET;
  const g = store.global();
  let secret = g.get('dashboard.secret', null);
  if (typeof secret !== 'string' || secret.length < 32) secret = g.set('dashboard.secret', random(48));
  return secret;
}

/**
 * Session, magic link and OAuth state manager.
 * @param {{store: object, secret?: string, now?: () => number}} opts
 */
function createAuth(opts) {
  const { store } = opts;
  const now = opts.now || Date.now;
  const secret = opts.secret || loadSecret(store);
  const links = new Map();
  const states = new Map();
  const sessions = new Map(Object.entries(store.global().get(STORE_PATH, {}) || {}));

  const mac = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');

  /** "<value>.<hmac>" */
  const sign = (value) => `${value}.${mac(value)}`;

  /** Returns the value when the signature is valid, null otherwise. */
  const verify = (signed) => {
    if (typeof signed !== 'string' || signed.length > 200) return null;
    const idx = signed.lastIndexOf('.');
    if (idx < 1) return null;
    const value = signed.slice(0, idx);
    return safeEqual(mac(value), signed.slice(idx + 1)) ? value : null;
  };

  const persist = () => store.global().set(STORE_PATH, Object.fromEntries(sessions));

  /** Drops expired sessions, links and OAuth states. */
  const prune = () => {
    const t = now();
    let changed = false;
    for (const [k, s] of sessions) if (s.expiresAt <= t) { sessions.delete(k); changed = true; }
    for (const [k, l] of links) if (l.expiresAt <= t) links.delete(k);
    for (const [k, s] of states) if (s.expiresAt <= t) states.delete(k);
    if (changed) persist();
  };

  /**
   * Creates a session and returns the signed cookie value.
   * @param {string} userId
   * @param {{guilds?: string[], oauth?: object}} [data]
   * @returns {{cookie: string, session: object}}
   */
  const createSession = (userId, data = {}) => {
    prune();
    if (sessions.size >= MAX_SESSIONS) {
      // Evict the oldest session instead of refusing logins.
      const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) sessions.delete(oldest[0]);
    }
    const sid = random(32);
    const session = {
      userId: String(userId),
      guilds: [...new Set((data.guilds || []).map(String))],
      oauth: data.oauth || null,
      csrf: random(24),
      createdAt: now(),
      expiresAt: now() + SESSION_TTL
    };
    sessions.set(hash(sid), session);
    persist();
    return { cookie: sign(sid), session };
  };

  /**
   * Finds the live session for a signed cookie value.
   * @param {string} cookie
   * @returns {object|null}
   */
  const getSession = (cookie) => {
    const sid = verify(cookie);
    if (!sid) return null;
    const session = sessions.get(hash(sid));
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(hash(sid));
      persist();
      return null;
    }
    return session;
  };

  /** Adds a guild to an existing session (second magic link for another server). */
  const grantGuild = (cookie, guildId) => {
    const session = getSession(cookie);
    if (!session) return null;
    if (!session.guilds.includes(String(guildId))) session.guilds.push(String(guildId));
    persist();
    return session;
  };

  /** Deletes the session behind a cookie. */
  const destroySession = (cookie) => {
    const sid = verify(cookie);
    if (sid && sessions.delete(hash(sid))) persist();
  };

  /**
   * Issues a one-time login token bound to a user and a guild.
   * @param {string} userId
   * @param {string} guildId
   * @returns {string} raw token (only ever shown to the user, in an ephemeral reply)
   */
  const issueLink = (userId, guildId) => {
    prune();
    const token = random(32);
    links.set(hash(token), { userId: String(userId), guildId: String(guildId), expiresAt: now() + LINK_TTL });
    return token;
  };

  /**
   * Consumes a magic link token. Works once; expired or unknown tokens give null.
   * @param {string} token
   * @returns {{userId: string, guildId: string}|null}
   */
  const consumeLink = (token) => {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const key = hash(token);
    const link = links.get(key);
    if (!link) return null;
    links.delete(key);
    if (link.expiresAt <= now()) return null;
    return { userId: link.userId, guildId: link.guildId };
  };

  /** Creates an OAuth "state" value (anti login-CSRF), single use. */
  const issueState = () => {
    prune();
    const state = random(24);
    states.set(state, { expiresAt: now() + STATE_TTL });
    return state;
  };

  /** Validates and consumes an OAuth state. */
  const consumeState = (state) => {
    if (typeof state !== 'string' || !states.has(state)) return false;
    const entry = states.get(state);
    states.delete(state);
    return entry.expiresAt > now();
  };

  /** True when the given token matches the session CSRF token. */
  const checkCsrf = (session, token) => !!session && safeEqual(session.csrf, token);

  return { sign, verify, createSession, getSession, grantGuild, destroySession, issueLink, consumeLink, issueState, consumeState, checkCsrf, prune, sessions, links };
}

module.exports = { createAuth, safeEqual, loadSecret, SESSION_TTL, LINK_TTL };
