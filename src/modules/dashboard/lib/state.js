'use strict';

const { createDashboardServer } = require('./server');

let instance = null;
let port = null;
let lastError = null;

/** Port from DASHBOARD_PORT, then PORT / SERVER_PORT (injected by hosting panels). */
function configuredPort() {
  for (const name of ['DASHBOARD_PORT', 'PORT', 'SERVER_PORT']) {
    const v = Number(process.env[name]);
    if (Number.isInteger(v) && v > 0 && v < 65536) return v;
  }
  return null;
}

/**
 * Modules with their dashboard schema: ctx.modules when bot.js provides it,
 * otherwise the loader (require() caches, so this does not reload code).
 */
function modulesOf(ctx) {
  if (Array.isArray(ctx.modules)) return ctx.modules;
  if (!modulesOf.cache) modulesOf.cache = require('../../../core/loader').loadModules();
  return modulesOf.cache;
}

/**
 * Starts the server if a port is configured; logs one localized line otherwise.
 * @param {object} ctx
 * @returns {Promise<object|null>}
 */
async function start(ctx) {
  if (instance) return instance;
  const lang = process.env.DEFAULT_LANGUAGE || 'en';
  const p = configuredPort();
  lastError = null;
  if (!p) {
    ctx.logger.info(ctx.t(lang, 'dashboard:console.disabled'));
    return null;
  }
  const created = createDashboardServer({ ctx, getModules: () => modulesOf(ctx) });
  try {
    port = await created.listen(p, '0.0.0.0');
  } catch (err) {
    lastError = err.message;
    ctx.logger.error(ctx.t(lang, 'dashboard:console.listenFailed', { port: p, error: err.message }));
    return null;
  }
  instance = created;
  const url = created.publicUrl.get();
  ctx.logger.info(ctx.t(lang, url ? 'dashboard:console.started' : 'dashboard:console.startedNoUrl', { port, url: url || '' }));
  return instance;
}

/** Stops the server (graceful shutdown, tests). */
async function stop() {
  if (!instance) return;
  const s = instance;
  instance = null;
  port = null;
  await s.close();
}

module.exports = { start, stop, configuredPort, modulesOf, get: () => instance, port: () => port,
  /** Why the server is not running, for /dashboard diagnostics: 'noPort' | 'listenFailed' | null. */
  problem: () => (!instance ? (configuredPort() ? 'listenFailed' : 'noPort') : null),
  error: () => lastError };
