'use strict';

const { Client, Events, Partials, Options } = require('discord.js');
const store = require('./core/store');
const i18n = require('./core/i18n');
const embeds = require('./core/embeds');
const permissions = require('./core/permissions');
const scheduler = require('./core/scheduler');
const modlog = require('./core/modlog');
const loader = require('./core/loader');
const registry = require('./core/registry');
const intents = require('./core/intents');
const { createRouter } = require('./core/interactions');
const { patchMessaging } = require('./core/plain');
const logger = require('./core/logger');

const log = logger.child('bot');
// Discord accepts at most 100 global (and 100 per-guild) chat input commands.
const COMMAND_LIMIT = 100;
const SHUTDOWN_HOOK_MS = 5000;
// Guild settings files kept in memory; older ones are saved and re-read on demand.
const STORE_CACHE_MAX = 200;
const STORE_TRIM_MS = 10 * 60 * 1000;

/**
 * Cache limits. The bot shares 315 MB with ffmpeg, so we aim for < 90 MB RSS:
 * - messages: 50 per channel is enough for automod duplicate checks, edit/delete
 *   logs and snipe; older ones arrive as partials and are handled as such;
 * - presences: never cached (no GuildPresences intent either);
 * - reactions, thread members, stage instances, scheduled events, bans,
 *   invites and auto-moderation rules: fetched when needed, not cached (the
 *   logs module keeps its own small invite-use map);
 * - emojis and stickers stay cached: discord.js only emits their delete events
 *   for cached items, and antinuke/logs rely on those;
 * - voice states stay unlimited: music and voice logs need them;
 * - members stay unlimited (role hierarchy checks, welcome, antiraid) but the
 *   sweeper below drops idle ones every hour.
 */
const CACHE_LIMITS = {
  ...Options.DefaultMakeCacheSettings,
  MessageManager: 50,
  PresenceManager: 0,
  ReactionManager: 0,
  ReactionUserManager: 0,
  ThreadMemberManager: 0,
  StageInstanceManager: 0,
  GuildScheduledEventManager: 0,
  GuildBanManager: 0,
  GuildInviteManager: 0,
  AutoModerationRuleManager: 0,
  ApplicationCommandManager: 0,
  DMMessageManager: 0
};

/** Sweepers: messages older than 15 min, plus idle users and members every hour. */
const SWEEPERS = {
  ...Options.DefaultSweeperSettings,
  messages: { interval: 300, lifetime: 900 },
  // Never drop the bot itself, nor members in voice (music checks "same channel").
  users: { interval: 3600, filter: () => (user) => user.id !== user.client.user?.id },
  guildMembers: { interval: 3600, filter: () => (member) => member.id !== member.client.user?.id && !member.voice?.channelId }
};

/** Console messages use the default language: there is no guild to read it from. */
const ct = (key, vars) => i18n.t(i18n.defaultLanguage(), key, vars);

/**
 * Builds the shared ctx handed to every command, event and component.
 * ctx.modules (loaded modules), ctx.commandIds (name → Discord id, for clickable
 * mentions) and ctx.startedAt are extras beyond the base contract.
 * @param {ReturnType<typeof loader.loadModules>} modules
 * @param {import('discord.js').Client|null} client
 */
function createContext(modules, client = null) {
  return {
    client, store, t: i18n.t, i18n, embeds, permissions, logger, scheduler, modlog,
    modules, commandIds: new Map(), startedAt: Date.now()
  };
}

/**
 * Counts what the loaded modules provide and builds every command JSON.
 * @param {ReturnType<typeof loader.loadModules>} modules
 */
function summarize(modules) {
  const body = registry.buildAll(modules);
  return {
    body,
    modules: modules.length,
    commands: body.length,
    events: modules.reduce((n, m) => n + m.events.length, 0),
    components: modules.reduce((n, m) => n + m.components.length, 0),
    sizeKb: Math.round(Buffer.byteLength(JSON.stringify(body)) / 102.4) / 10
  };
}

/** Invite link with the scopes the bot needs and Administrator (protection modules touch everything). */
const inviteUrl = (appId) => `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=8`;

/**
 * Registers slash commands (guild-scoped when GUILD_ID is set) and records their
 * ids for /help mentions. Failures are explained, never fatal.
 */
async function registerCommands(client, ctx, body) {
  const guildId = process.env.GUILD_ID?.trim() || undefined;
  if (body.length > COMMAND_LIMIT) log.warn(ct('common:console.tooManyCommands', { count: body.length, max: COMMAND_LIMIT }));
  try {
    await registry.register(process.env.DISCORD_TOKEN, client.application.id, body.slice(0, COMMAND_LIMIT), guildId);
    const registered = guildId ? await (await client.guilds.fetch(guildId)).commands.fetch() : await client.application.commands.fetch();
    for (const cmd of registered.values()) ctx.commandIds.set(cmd.name, cmd.id);
  } catch (err) {
    if (guildId && (err.code === 50001 || err.code === 10004)) log.error(ct('common:console.registerMissingAccess', { guild: guildId }));
    else log.error(ct('common:console.registerFailed', { error: err.message }));
  }
}

/** Prints the privileged-intent help in the configured language. */
function explainIntents(missing, degraded = true) {
  const names = missing.map((name) => intents.PRIVILEGED[name].portal).join(', ');
  log.warn(ct('common:console.disallowedIntents', { intents: names }));
  if (degraded) log.warn(ct('common:console.degraded', { features: missing.map((name) => ct(`common:console.intentFeatures.${name}`)).join(' ; ') }));
}

/**
 * Installs process-wide safety nets and the SIGINT/SIGTERM handler that runs
 * module shutdown hooks, stops timers and flushes the store before exiting.
 */
function installProcessHandlers(ctx) {
  process.on('unhandledRejection', (reason) => log.error(ct('common:console.unhandled'), reason));
  process.on('uncaughtException', (err) => log.error(ct('common:console.unhandled'), err));

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal}: ${ct('common:console.shuttingDown')}`);
    // Hard stop in case a hook or the gateway hangs: data is flushed first anyway.
    setTimeout(() => { try { store.flush(); } catch { /* already reported */ } process.exit(0); }, SHUTDOWN_HOOK_MS * 2).unref();
    for (const mod of ctx.modules) {
      if (typeof mod.shutdown !== 'function') continue;
      try {
        await Promise.race([Promise.resolve(mod.shutdown(ctx)), new Promise((r) => setTimeout(r, SHUTDOWN_HOOK_MS).unref())]);
      } catch (err) {
        log.error(`shutdown() of ${mod.name} failed:`, err);
      }
    }
    scheduler.stop();
    try { store.flush(); } catch (err) { log.error('Store flush failed:', err); }
    try { await ctx.client?.destroy(); } catch { /* the process is exiting */ }
    log.info(ct('common:console.stopped'));
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return shutdown;
}

/** DRY_RUN=1: load and build everything, print a summary, never connect. */
function dryRun(modules) {
  const s = summarize(modules);
  log.info(ct('common:console.dryRun', { modules: s.modules, commands: s.commands, events: s.events, components: s.components, size: s.sizeKb }));
  for (const mod of modules) log.info(`  ${mod.name.padEnd(16)} /${mod.commands.map((c) => c.data.name).join(' /') || '-'}`);
  if (s.commands > COMMAND_LIMIT) log.warn(ct('common:console.tooManyCommands', { count: s.commands, max: COMMAND_LIMIT }));
  return s;
}

/**
 * Starts the bot: load modules, check the token and privileged intents, log in,
 * then on ready init modules, arm the scheduler and register commands.
 * @returns {Promise<import('discord.js').Client|null>}
 */
async function start() {
  patchMessaging();
  const modules = loader.loadModules();
  if (process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true') {
    dryRun(modules);
    store.flush();
    process.exit(0);
  }

  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) {
    log.error(ct('common:console.missingToken'));
    process.exitCode = 1;
    return null;
  }
  const summary = summarize(modules);
  log.info(ct('common:console.starting', { modules: summary.modules, commands: summary.commands }));

  let wanted = intents.INTENTS;
  try {
    const app = await intents.fetchApplication(token);
    const missing = intents.missingPrivileged(app.flags);
    if (missing.length) {
      explainIntents(missing);
      wanted = intents.withoutIntents(wanted, missing);
    }
  } catch (err) {
    if (err.status === 401) {
      log.error(ct('common:console.invalidToken'));
      process.exitCode = 1;
      return null;
    }
    // Network hiccup: try the full intent set, the login error handler explains a refusal.
    log.warn('Could not read application flags:', err.message);
  }

  const client = new Client({
    intents: wanted,
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
    allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
    makeCache: Options.cacheWithLimits(CACHE_LIMITS),
    sweepers: SWEEPERS
  });
  const ctx = createContext(modules, client);
  installProcessHandlers(ctx);

  client.on(Events.Error, (err) => log.error('Client error:', err));
  client.on(Events.Warn, (msg) => log.warn(msg));
  client.on(Events.InteractionCreate, createRouter(ctx));
  loader.attachEvents(client, ctx, modules);

  client.once(Events.ClientReady, async (ready) => {
    log.info(ct('common:console.ready', { tag: ready.user.tag, guilds: ready.guilds.cache.size }));
    log.info(ct('common:console.invite', { url: inviteUrl(ready.application.id) }));
    // init before scheduler.start so modules register their job handlers first.
    await loader.initModules(client, ctx, modules);
    scheduler.start();
    await registerCommands(client, ctx, summary.body);
    setInterval(() => store.trim(STORE_CACHE_MAX), STORE_TRIM_MS).unref();
  });

  try {
    await client.login(token);
  } catch (err) {
    if (intents.isDisallowedIntents(err)) explainIntents(Object.keys(intents.PRIVILEGED), false);
    else if (err.code === 'TokenInvalid') log.error(ct('common:console.invalidToken'));
    else log.error('Login failed:', err);
    store.flush();
    process.exitCode = 1;
    await client.destroy().catch(() => {});
    return null;
  }
  return client;
}

module.exports = { start, createContext, summarize, dryRun, inviteUrl, COMMAND_LIMIT, CACHE_LIMITS, SWEEPERS };
