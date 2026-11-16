'use strict';

const { readConfig, effectiveLimit, isTriggered } = require('./logic');
const { windows, flagged } = require('./memory');
const { punish } = require('./punish');
const { undo } = require('./restore');
const { getPanic, startPanic, report } = require('./panic');

const NS = 'antinuke';

/**
 * Core antinuke decision for one action by one executor.
 * Every action by an untrusted member goes into a sliding window per
 * (executor, action). Once the window holds more than the limit, the executor is
 * punished, every action in the window is undone, and the executor is flagged:
 * for the next minutes anything else they do is undone immediately, even if
 * the punishment failed (for example a role above the bot).
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {string} executorId
 * @param {{action: string, targetId: string|null, data?: any}} item
 * @returns {Promise<'ignored'|'counted'|'triggered'|'followup'>}
 */
async function handle(ctx, guild, executorId, item) {
  if (!executorId || executorId === ctx.client.user?.id) return 'ignored';
  if (ctx.permissions.isWhitelisted(guild, executorId)) return 'ignored';
  const cfg = readConfig(ctx.store.guild(guild.id));
  const panic = !!getPanic(ctx.store, guild.id);
  if (!cfg.enabled && !panic) return 'ignored';

  const key = `${guild.id}:${executorId}`;
  const reason = ctx.t(guild, `${NS}:reason`, { action: ctx.t(guild, `${NS}:actions.${item.action}`) });
  if (flagged.has(key)) {
    if (cfg.restore) await undo(guild, item, reason).catch((err) => ctx.logger.debug('antinuke undo failed:', err.message));
    return 'followup';
  }

  const { limit, windowSec } = effectiveLimit(cfg, item.action, panic);
  const list = windows.hit(`${key}:${item.action}`, windowSec * 1000, item);
  if (!isTriggered(list.length, limit)) return 'counted';
  // Flag synchronously: the next audit entries of a nuke arrive while we are still awaiting below.
  flagged.set(key, true);
  windows.clear(`${key}:${item.action}`);

  // Stopping the attacker comes first; cleaning up comes after.
  const result = await punish(ctx, guild, executorId, cfg, reason);
  let restored = 0;
  let failed = 0;
  if (cfg.restore) {
    for (const it of list) {
      try {
        if (await undo(guild, it, reason)) restored++;
      } catch (err) {
        failed++;
        ctx.logger.debug(`antinuke undo of ${it.action} failed:`, err.message);
      }
    }
  }
  let panicText = ctx.t(guild, `${NS}:alert.panicNo`);
  if (panic) panicText = ctx.t(guild, `${NS}:alert.panicAlready`);
  else if (cfg.autoPanic) {
    const res = await startPanic(ctx, guild, { by: null, auto: true, reason: ctx.t(guild, `${NS}:actions.${item.action}`) });
    if (res.started) panicText = ctx.t(guild, `${NS}:alert.panicStarted`);
  }

  const restoreText = cfg.restore ? ctx.t(guild, `${NS}:alert.restoreValue`, { restored, failed, total: list.length }) : ctx.t(guild, `${NS}:alert.restoreOff`);
  await report(ctx, guild, ctx.embeds.error(ctx.t(guild, `${NS}:alert.title`), ctx.t(guild, `${NS}:alert.description`, {
    user: `<@${executorId}> (${executorId})`,
    action: ctx.t(guild, `${NS}:actions.${item.action}`),
    count: list.length,
    seconds: windowSec,
    limit
  }), {
    fields: [
      { name: ctx.t(guild, `${NS}:alert.punishment`), value: ctx.t(guild, `${NS}:punish.results.${result}`), inline: true },
      { name: ctx.t(guild, `${NS}:alert.restore`), value: restoreText, inline: true },
      { name: ctx.t(guild, `${NS}:alert.panic`), value: panicText, inline: true }
    ],
    timestamp: true
  }));
  return 'triggered';
}

module.exports = { handle };
