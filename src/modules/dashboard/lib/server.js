'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../../../core/i18n');
const { createAuth, SESSION_TTL } = require('./auth');
const { createAccess } = require('./access');
const { createRateLimiter } = require('./ratelimit');
const { createApi } = require('./api');
const { collect } = require('./schema');
const oauth = require('./oauth');
const h = require('./http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Fixed map of the only files ever served: request paths are looked up in it and
// never joined to a directory, so path traversal cannot reach the disk.
const STATIC = {
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/render.js': ['render.js', 'text/javascript; charset=utf-8'],
  '/pages.js': ['pages.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml']
};
const PAGES = new Set(['/', '/login', '/dashboard']);
const SNOWFLAKE = /^\d{15,22}$/;

/**
 * Creates the dashboard HTTP server (not listening yet).
 * @param {{ctx: object, getModules: () => object[], now?: () => number}} opts
 * @returns {{server: http.Server, auth: object, access: object, publicUrl: object, listen: (port: number, host?: string) => Promise<number>, close: () => Promise<void>}}
 */
function createDashboardServer(opts) {
  const { ctx } = opts;
  const log = ctx.logger?.child ? ctx.logger.child('dashboard') : ctx.logger || console;
  const auth = createAuth({ store: ctx.store, now: opts.now });
  const access = createAccess(ctx, { now: opts.now });
  const publicUrl = h.createPublicUrl(ctx.store);
  const loginLimit = createRateLimiter({ limit: 10, windowMs: 60000, now: opts.now });
  const postLimit = createRateLimiter({ limit: 60, windowMs: 60000, now: opts.now });
  const files = {};
  for (const [route, [file, type]] of Object.entries(STATIC)) {
    const full = path.join(PUBLIC_DIR, file);
    if (fs.existsSync(full)) files[route] = { body: fs.readFileSync(full), type };
  }
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'));

  let schemaCache = { source: null, value: [] };
  const getSchemas = () => {
    const mods = opts.getModules();
    if (schemaCache.source !== mods) schemaCache = { source: mods, value: collect(mods, log) };
    return schemaCache.value;
  };
  const api = createApi({ ctx, getSchemas });

  const send = (req, res, status, body, extra = {}) => {
    const isText = typeof body === 'string' || Buffer.isBuffer(body);
    const payload = isText ? body : JSON.stringify(body);
    res.writeHead(status, {
      ...h.securityHeaders(h.isHttps(req)),
      'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra
    });
    res.end(payload);
  };
  const redirect = (req, res, location, extra = {}) => send(req, res, 303, '', { Location: location, ...extra });

  const sessionOf = (req) => auth.getSession(h.parseCookies(req)[h.COOKIE]);
  const sessionCookie = (req, value, maxAge) => h.cookie(h.COOKIE, value, { maxAge, secure: h.isHttps(req) || /^https:/.test(publicUrl.get() || '') });

  /** Rejects cross-site POSTs: Origin (when sent) must be this host, and the CSRF token must match. */
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = String((h.trustProxy() && req.headers['x-forwarded-host']) || req.headers.host || '').split(',')[0].trim();
    try { return new URL(origin).host === host; } catch { return false; }
  };

  const limited = (req, res, limiter, bucket) => {
    const r = limiter.hit(`${bucket}:${h.clientIp(req)}`);
    if (r.ok) return false;
    send(req, res, 429, { error: 'rateLimited', retryAfter: r.retryAfter }, { 'Retry-After': String(r.retryAfter) });
    return true;
  };

  /** Guilds the session may open, re-checked against Discord right now. */
  const allowedGuilds = async (session) => {
    const ids = session.guilds.filter((id) => ctx.client.guilds.cache.has(id));
    const out = [];
    for (const id of ids) {
      const guild = await access.check(id, session.userId);
      if (guild) out.push({ id: guild.id, name: guild.name, icon: typeof guild.iconURL === 'function' ? guild.iconURL({ size: 64, extension: 'png' }) : null, memberCount: guild.memberCount ?? 0 });
    }
    return out;
  };

  const me = async (session) => {
    const lang = i18n.defaultLanguage();
    if (!session) return { user: null, oauth: oauth.enabled(), languages: i18n.LANGUAGES, defaultLanguage: lang };
    let user = session.oauth;
    if (!user) {
      const u = ctx.client.users.cache.get(session.userId) || (await ctx.client.users.fetch(session.userId).catch(() => null));
      user = { id: session.userId, username: u?.globalName || u?.username || session.userId, avatar: u?.avatar || null };
    }
    const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${session.userId}/${user.avatar}.png?size=64` : null;
    return { user: { id: session.userId, username: user.username, avatar }, csrf: session.csrf, oauth: oauth.enabled(), languages: i18n.LANGUAGES, defaultLanguage: lang };
  };

  const clientId = () => process.env.DISCORD_CLIENT_ID || ctx.client.application?.id || ctx.client.user?.id;

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    const method = req.method;
    publicUrl.learn(req);

    if (method === 'GET' || method === 'HEAD') {
      if (p === '/healthz') return send(req, res, 200, 'ok');
      if (PAGES.has(p)) return send(req, res, 200, indexHtml, { 'Content-Type': 'text/html; charset=utf-8' });
      if (files[p]) return send(req, res, 200, files[p].body, { 'Content-Type': files[p].type, 'Cache-Control': 'no-cache' });
    }

    // Discord OAuth2 (optional).
    if (method === 'GET' && p === '/auth/discord') {
      if (!oauth.enabled() || !publicUrl.get() || !clientId()) return redirect(req, res, '/');
      if (limited(req, res, loginLimit, 'login')) return undefined;
      const state = auth.issueState();
      const stateCookie = h.cookie(h.STATE_COOKIE, state, { maxAge: 600, secure: h.isHttps(req) });
      return redirect(req, res, oauth.authorizeUrl(clientId(), `${publicUrl.get()}/auth/callback`, state), { 'Set-Cookie': stateCookie });
    }
    if (method === 'GET' && p === '/auth/callback') {
      if (limited(req, res, loginLimit, 'login')) return undefined;
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      const clear = h.cookie(h.STATE_COOKIE, '', { maxAge: 0, secure: h.isHttps(req) });
      // The state must be ours and match the cookie set on this browser (anti login-CSRF).
      if (!oauth.enabled() || !code || !state || h.parseCookies(req)[h.STATE_COOKIE] !== state || !auth.consumeState(state)) {
        return redirect(req, res, '/?error=oauth', { 'Set-Cookie': clear });
      }
      try {
        const result = await oauth.exchange({ clientId: clientId(), code, redirectUri: `${publicUrl.get()}/auth/callback` });
        const guilds = result.manageable.filter((id) => ctx.client.guilds.cache.has(id));
        const { cookie } = auth.createSession(result.user.id, { guilds, oauth: result.user });
        return redirect(req, res, '/', { 'Set-Cookie': [clear, sessionCookie(req, cookie, SESSION_TTL / 1000)] });
      } catch (err) {
        log.warn('dashboard: OAuth login failed:', err.message);
        return redirect(req, res, '/?error=oauth', { 'Set-Cookie': clear });
      }
    }

    if (p.startsWith('/api/') || p === '/logout') return handleApi(req, res, url, p, method);
    return send(req, res, 404, { error: 'notFound' });
  }

  async function handleApi(req, res, url, p, method) {
    let session = sessionOf(req);

    if (method === 'GET' && p === '/api/me') return send(req, res, 200, await me(session));
    const i18nMatch = p.match(/^\/api\/i18n\/([a-z]{2})$/);
    if (method === 'GET' && i18nMatch) {
      if (!i18n.LANGUAGES.includes(i18nMatch[1])) return send(req, res, 404, { error: 'notFound' });
      return send(req, res, 200, api.translations(i18nMatch[1]));
    }

    if (method === 'POST') {
      if (!sameOrigin(req)) return send(req, res, 403, { error: 'origin' });
      if (p === '/api/login') {
        if (limited(req, res, loginLimit, 'login')) return undefined;
        const body = await h.readJson(req);
        const link = auth.consumeLink(body.token);
        if (!link) return send(req, res, 401, { error: 'invalidLink' });
        const cookieValue = h.parseCookies(req)[h.COOKIE];
        // Same user already logged in: add this server to the existing session.
        if (session && session.userId === link.userId) {
          auth.grantGuild(cookieValue, link.guildId);
          return send(req, res, 200, { ok: true, guildId: link.guildId, csrf: session.csrf });
        }
        if (session) auth.destroySession(cookieValue);
        const created = auth.createSession(link.userId, { guilds: [link.guildId] });
        return send(req, res, 200, { ok: true, guildId: link.guildId, csrf: created.session.csrf }, { 'Set-Cookie': sessionCookie(req, created.cookie, SESSION_TTL / 1000) });
      }
      if (limited(req, res, postLimit, 'post')) return undefined;
      if (!session) return send(req, res, 401, { error: 'unauthenticated' });
      if (!auth.checkCsrf(session, req.headers['x-csrf-token'])) return send(req, res, 403, { error: 'csrf' });
      if (p === '/logout') {
        auth.destroySession(h.parseCookies(req)[h.COOKIE]);
        access.forget(session.userId);
        session = null;
        return send(req, res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
      }
    }

    if (!session) return send(req, res, 401, { error: 'unauthenticated' });
    if (method === 'GET' && p === '/api/guilds') return send(req, res, 200, { guilds: await allowedGuilds(session) });

    const m = p.match(/^\/api\/guilds\/([^/]+)\/(overview|schema|config|resources|actions)(?:\/([\w-]{1,64})\/([\w-]{1,64}))?$/);
    if (!m) return send(req, res, 404, { error: 'notFound' });
    const [, guildId, kind, modName, actionId] = m;
    if (!SNOWFLAKE.test(guildId) || !session.guilds.includes(guildId)) return send(req, res, 403, { error: 'forbidden' });
    const guild = await access.check(guildId, session.userId);
    if (!guild) return send(req, res, 403, { error: 'forbidden' });

    if (method === 'GET' && !modName) {
      if (kind === 'overview') return send(req, res, 200, await api.overview(guild));
      if (kind === 'schema') return send(req, res, 200, api.schema(guild, session.userId));
      if (kind === 'config') return send(req, res, 200, api.config(guild));
      if (kind === 'resources') return send(req, res, 200, api.resources(guild));
    }
    if (method === 'POST' && kind === 'config' && !modName) {
      const out = await api.saveConfig(guild, session.userId, await h.readJson(req));
      return send(req, res, out.status, out.body);
    }
    if (method === 'POST' && kind === 'actions' && modName) {
      const body = await h.readJson(req);
      const lang = i18n.LANGUAGES.includes(body.lang) ? body.lang : null;
      const out = await api.runAction(guild, session.userId, modName, actionId, lang);
      return send(req, res, out.status, out.body);
    }
    return send(req, res, 405, { error: 'method' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err?.status) return send(req, res, err.status, { error: err.message });
      log.error('dashboard: request failed:', err);
      if (!res.headersSent) send(req, res, 500, { error: 'internal' });
      return undefined;
    });
  });
  // Slow-loris protection; the dashboard never needs long requests.
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  const pruneTimer = setInterval(() => auth.prune(), 10 * 60 * 1000);
  pruneTimer.unref();

  return {
    server,
    auth,
    access,
    publicUrl,
    listen: (port, host = '0.0.0.0') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server.address().port));
    }),
    close: () => new Promise((resolve) => {
      clearInterval(pruneTimer);
      server.close(() => resolve());
      server.closeAllConnections?.();
    })
  };
}

module.exports = { createDashboardServer, STATIC };
