'use strict';

const { FILTER_ORDER } = require('./filters');
const { FILTERS } = require('./config');
const duration = require('../../../core/duration');

/**
 * Short description of a filter's thresholds, e.g. "6 messages / 5 s".
 * @param {Function} t
 * @param {*} lang
 * @param {string} name
 * @param {object} f Filter config from getConfig().
 */
function thresholdText(t, lang, name, f) {
  const vars = { ...f, allowOwn: t(lang, f.allowOwn ? 'automod:status.yes' : 'automod:status.no') };
  return t(lang, `automod:filters.${name}.threshold`, vars);
}

/**
 * Action text, with its duration when it has one.
 * @param {Function} t
 * @param {*} lang
 * @param {string} action
 * @param {number} [ms]
 */
function actionText(t, lang, action, ms) {
  const label = t(lang, `automod:actions.${action}`);
  return ms && ['timeout', 'ban'].includes(action) ? `${label} (${duration.format(ms, lang)})` : label;
}

/**
 * Overview embed of the automod configuration (used by /automod status and
 * after every change, so admins always see the effect of a command).
 * @param {object} ctx
 * @param {*} lang
 * @param {ReturnType<import('./config').getConfig>} cfg
 * @param {{success?: boolean}} [opts]
 */
function statusEmbed(ctx, lang, cfg, opts = {}) {
  const { t, embeds } = ctx;
  const lines = FILTER_ORDER.map((name) => {
    const f = cfg.filters[name];
    const state = f.enabled ? t(lang, 'automod:status.on') : t(lang, 'automod:status.off');
    const extra = f.enabled ? ` · ${actionText(t, lang, f.action, f.duration)} · ${thresholdText(t, lang, name, f)}` : '';
    const exempt = f.exemptRoles.length + f.exemptChannels.length;
    return `**${t(lang, `automod:filters.${name}.name`)}** — ${state}${extra}${exempt ? ` · ${t(lang, 'automod:status.exemptCount', { count: exempt })}` : ''}`;
  });
  const steps = cfg.escalation.map((s) => t(lang, 'automod:status.step', { strikes: s.strikes, action: actionText(t, lang, s.action, s.duration) }));
  const fields = [
    { name: t(lang, 'automod:status.filters'), value: lines.join('\n') },
    { name: t(lang, 'automod:status.escalation'), value: steps.join('\n') || t(lang, 'automod:status.none') },
    { name: t(lang, 'automod:status.strikeWindow'), value: cfg.strikeWindow ? duration.format(cfg.strikeWindow, lang) : t(lang, 'automod:status.never'), inline: true },
    { name: t(lang, 'automod:status.ignoreStaff'), value: t(lang, cfg.ignoreStaff ? 'automod:status.yes' : 'automod:status.no'), inline: true },
    { name: t(lang, 'automod:status.notify'), value: t(lang, cfg.notify ? 'automod:status.yes' : 'automod:status.no'), inline: true },
    { name: t(lang, 'automod:status.exemptRoles'), value: cfg.exemptRoles.map((r) => `<@&${r}>`).join(' ') || t(lang, 'automod:status.none'), inline: true },
    { name: t(lang, 'automod:status.exemptChannels'), value: cfg.exemptChannels.map((c) => `<#${c}>`).join(' ') || t(lang, 'automod:status.none'), inline: true },
    { name: t(lang, 'automod:status.lists'), value: t(lang, 'automod:status.listsValue', { words: cfg.badwords.length, allow: cfg.links.allow.length, deny: cfg.links.deny.length, mode: t(lang, `automod:linkModes.${cfg.links.mode}`) }) }
  ];
  const title = t(lang, 'automod:status.title');
  const description = t(lang, cfg.enabled ? 'automod:status.enabled' : 'automod:status.disabled');
  return opts.success ? embeds.success(title, description, { fields }) : embeds.info(title, description, { fields });
}

/** Names of the filters that have a given parameter (for /automod set validation). */
function filtersWith(param) {
  return Object.entries(FILTERS).filter(([, def]) => def.params[param]).map(([name]) => name);
}

module.exports = { statusEmbed, thresholdText, actionText, filtersWith };
