'use strict';

const logger = require('./logger').child('audit');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Finds who performed an action by reading the audit log. Entries can appear a
 * little after the gateway event, so this retries a few times.
 * @param {import('discord.js').Guild} guild
 * @param {number} type An AuditLogEvent value.
 * @param {string} [targetId] Only accept entries about this target.
 * @param {{retries?: number, delayMs?: number, maxAgeMs?: number}} [opts]
 * @returns {Promise<{executor: import('discord.js').User, entry: import('discord.js').GuildAuditLogsEntry}|null>}
 */
async function fetchExecutor(guild, type, targetId, opts = {}) {
  const { retries = 3, delayMs = 800, maxAgeMs = 15000 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const logs = await guild.fetchAuditLogs({ type, limit: 6 });
      const entry = logs.entries.find((e) => (!targetId || e.targetId === targetId || e.target?.id === targetId) && Date.now() - e.createdTimestamp < maxAgeMs);
      if (entry?.executor) return { executor: entry.executor, entry };
    } catch (err) {
      // Missing "View Audit Log" permission: retrying will not help.
      if (err.code === 50013) { logger.warn(`No audit log access in ${guild.id}`); return null; }
      logger.debug('fetchAuditLogs failed:', err.message);
    }
    if (attempt < retries) await sleep(delayMs);
  }
  return null;
}

module.exports = { fetchExecutor };
