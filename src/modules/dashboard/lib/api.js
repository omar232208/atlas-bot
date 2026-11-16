'use strict';

const i18n = require('../../../core/i18n');
const duration = require('../../../core/duration');
const { publicSchema, labelKeys, validatePatch } = require('./schema');
const { resources, countOpenTickets } = require('./access');

const HISTORY_PATH = 'dashboard.history';
const HISTORY_MAX = 30;
const PROTECTIONS = ['antiraid', 'antinuke', 'automod', 'verification'];

/** Tag of a user from the client cache (falls back to the id). */
async function userTag(ctx, userId) {
  try {
    const user = ctx.client.users.cache.get(userId) || (await ctx.client.users.fetch(userId));
    return user?.tag || user?.username || userId;
  } catch {
    return userId;
  }
}

/** Short, log-friendly text of a stored value. */
function formatValue(t, guild, field, value) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return t(guild, 'dashboard:log.none');
  switch (field.type) {
    case 'boolean': return t(guild, value ? 'dashboard:log.on' : 'dashboard:log.off');
    case 'channel': return `<#${value}>`;
    case 'role': return `<@&${value}>`;
    case 'channels': return value.map((id) => `<#${id}>`).join(' ');
    case 'roles': return value.map((id) => `<@&${id}>`).join(' ');
    case 'duration': return value ? duration.format(value, guild) : '0';
    case 'select': {
      const opt = (field.options || []).find((o) => o.value === value);
      return opt?.label ? t(guild, opt.label) : String(value);
    }
    case 'list': return value.join(', ');
    default: {
      const s = String(value);
      return s.length > 180 ? `${s.slice(0, 180)}...` : s;
    }
  }
}

/**
 * Builds the guild-scoped API handlers.
 * @param {{ctx: object, getSchemas: () => ReturnType<typeof import('./schema').collect>}} deps
 */
function createApi({ ctx, getSchemas }) {
  const { t, store } = ctx;

  const pushHistory = (guild, entry) => {
    store.guild(guild.id).update(HISTORY_PATH, (list) => [entry, ...(Array.isArray(list) ? list : [])].slice(0, HISTORY_MAX), []);
  };

  const readValue = (gs, field) => {
    const v = gs.get(field.path, field.default === undefined ? null : field.default);
    return v === undefined ? null : v;
  };

  /** GET /api/guilds/:id/overview */
  const overview = async (guild) => {
    const gs = store.guild(guild.id);
    const modules = getSchemas().filter((m) => m.toggle).map((m) => ({ module: m.name, enabled: !!readValue(gs, m.fields.get(m.toggle)), protection: PROTECTIONS.includes(m.name) }));
    const history = (gs.get(HISTORY_PATH, []) || []).slice(0, 10);
    return {
      guild: {
        id: guild.id,
        name: guild.name,
        icon: typeof guild.iconURL === 'function' ? guild.iconURL({ size: 128, extension: 'png' }) : null,
        memberCount: guild.memberCount ?? guild.members?.cache?.size ?? 0,
        channelCount: guild.channels.cache.size,
        roleCount: Math.max(0, guild.roles.cache.size - 1),
        language: i18n.resolveLang(guild)
      },
      modules,
      openTickets: countOpenTickets(gs),
      history
    };
  };

  const isOwner = (guild, userId) => !!ctx.permissions.isOwner(guild, userId);
  const ownerOnlyBody = (lang, guild, extra) => ({ error: 'ownerOnly', message: t(lang || guild, 'dashboard:api.ownerOnly'), ...extra });

  /** GET /api/guilds/:id/schema — owner-only parts come back readOnly for other admins. */
  const schema = (guild, userId) => {
    const viewer = { isOwner: isOwner(guild, userId) };
    return { isOwner: viewer.isOwner, modules: getSchemas().map((m) => publicSchema(m, viewer)) };
  };

  /** GET /api/guilds/:id/config */
  const config = (guild) => {
    const gs = store.guild(guild.id);
    const values = {};
    for (const m of getSchemas()) for (const [path, field] of m.fields) values[path] = readValue(gs, field);
    return { values };
  };

  /**
   * POST /api/guilds/:id/config — validates every change first, then writes them
   * all, so a patch is applied entirely or not at all.
   */
  const saveConfig = async (guild, userId, body) => {
    const mods = getSchemas();
    const lang = i18n.LANGUAGES.includes(body.lang) ? body.lang : null;
    const result = validatePatch(mods, body.changes, guild, { isOwner: isOwner(guild, userId) });
    if (Object.values(result.errors).some((e) => e.error === 'ownerOnly')) {
      ctx.logger?.warn?.(`dashboard: ${userId} tried to change owner-only settings in ${guild.id}`);
      return { status: 403, body: ownerOnlyBody(lang, guild, { fields: result.errors }) };
    }
    if (!result.ok) return { status: 400, body: { error: 'validation', fields: result.errors } };
    const gs = store.guild(guild.id);
    const changed = [];
    for (const { path, value, field, module } of result.values) {
      const before = readValue(gs, field);
      if (JSON.stringify(before) === JSON.stringify(value)) continue;
      gs.set(path, value);
      changed.push({ path, field, module, before, value });
    }
    if (changed.length) {
      const tag = await userTag(ctx, userId);
      pushHistory(guild, { at: Date.now(), userId, user: tag, kind: 'config', modules: [...new Set(changed.map((c) => c.module))], paths: changed.map((c) => c.path).slice(0, 20) });
      const fields = changed.slice(0, 24).map((c) => ({
        name: c.field.label ? t(guild, c.field.label) : c.path,
        value: `${formatValue(t, guild, c.field, c.before)} → ${formatValue(t, guild, c.field, c.value)}`.slice(0, 1024)
      }));
      if (changed.length > 24) fields.push({ name: '...', value: t(guild, 'dashboard:log.more', { count: changed.length - 24 }) });
      const embed = ctx.embeds.info(t(guild, 'dashboard:log.configTitle'), t(guild, 'dashboard:log.by', { user: `<@${userId}>`, tag }), { fields, timestamp: true });
      await ctx.modlog.send(guild, 'server', embed);
      ctx.logger?.info?.(`dashboard: ${tag} (${userId}) changed ${changed.map((c) => c.path).join(', ')} in ${guild.id}`);
    }
    return { status: 200, body: { ok: true, changed: changed.map((c) => c.path), values: config(guild).values } };
  };

  /** POST /api/guilds/:id/actions/:module/:action */
  const runAction = async (guild, userId, moduleName, actionId, lang) => {
    const mod = getSchemas().find((m) => m.name === moduleName);
    const action = mod?.actions.find((a) => a.id === actionId);
    if (!action) return { status: 404, body: { error: 'notFound' } };
    if (action.ownerOnly && !isOwner(guild, userId)) return { status: 403, body: ownerOnlyBody(lang, guild) };
    let key;
    try {
      key = await action.run(ctx, guild, userId);
    } catch (err) {
      ctx.logger?.warn?.(`dashboard: action ${moduleName}/${actionId} failed in ${guild.id}:`, err?.message || err);
      return { status: 500, body: { error: 'actionFailed', message: t(lang || guild, 'dashboard:api.actionFailed') } };
    }
    const tag = await userTag(ctx, userId);
    const label = action.label ? t(guild, action.label) : actionId;
    pushHistory(guild, { at: Date.now(), userId, user: tag, kind: 'action', modules: [moduleName], action: actionId });
    const embed = ctx.embeds.info(t(guild, 'dashboard:log.actionTitle'), t(guild, 'dashboard:log.actionBy', { user: `<@${userId}>`, tag, action: label }), { timestamp: true });
    await ctx.modlog.send(guild, 'server', embed);
    ctx.logger?.info?.(`dashboard: ${tag} (${userId}) ran ${moduleName}/${actionId} in ${guild.id}`);
    const message = typeof key === 'string' && key.includes(':') ? t(lang || guild, key) : t(lang || guild, 'dashboard:api.actionDone');
    return { status: 200, body: { ok: true, message } };
  };

  /** GET /api/i18n/:lang — dashboard namespace plus every schema label, translated. */
  const translations = (lang) => {
    const labels = {};
    const keys = labelKeys(getSchemas());
    for (const m of getSchemas()) keys.push(`${m.name}:dashboard.title`);
    for (const k of keys) {
      const v = i18n.t(lang, k);
      if (v !== k) labels[k] = v;
    }
    return { lang, ui: i18n.raw(lang, 'dashboard:ui') || i18n.raw('en', 'dashboard:ui') || {}, modules: i18n.raw(lang, 'dashboard:modules') || {}, labels };
  };

  return { overview, schema, config, saveConfig, runAction, translations, resources, formatValue };
}

module.exports = { createApi, formatValue, HISTORY_PATH };
