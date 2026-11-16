'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Minimal console logger with levels and timestamps. No dependency so it can be
 * used everywhere, including before the Discord client exists.
 * @param {string} [scope] Prefix shown in brackets (usually the module name).
 * @returns {{debug: Function, info: Function, warn: Function, error: Function, child: Function}}
 */
function createLogger(scope) {
  const write = (level, args) => {
    const min = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;
    if (LEVELS[level] < min) return;
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const prefix = `${stamp} ${level.toUpperCase().padEnd(5)}${scope ? ` [${scope}]` : ''}`;
    const out = level === 'error' || level === 'warn' ? console.error : console.log;
    out(prefix, ...args);
  };
  return {
    debug: (...a) => write('debug', a),
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    child: (sub) => createLogger(scope ? `${scope}:${sub}` : sub)
  };
}

module.exports = createLogger();
module.exports.createLogger = createLogger;
