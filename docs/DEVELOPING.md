# Developing ACLClouds Bot

This guide explains how the bot is organised and how to add a module. You only
need Node.js 20 or newer: there is no build step.

```bash
npm install
npm test          # unit tests (no Discord connection)
npm run check     # modules load, locales match, command JSON is valid, line counts
npm run dry-run   # loads everything and builds the commands, then exits
npm start         # real start (needs DISCORD_TOKEN in .env)
```

## How the bot starts

`index.js` loads `.env` and calls `start()` in `src/bot.js`, which:

1. discovers every `src/modules/<folder>/index.js` (`src/core/loader.js`);
2. reads the application flags with the token, to explain a disabled privileged
   intent (Server Members, Message Content) and start without it instead of
   crashing;
3. creates the client with small caches (the bot must stay well below 315 MB),
   attaches module events and one interaction router;
4. logs in; on `ClientReady` it calls each module's `init(client, ctx)`, arms the
   scheduler, then registers the slash commands (on `GUILD_ID` if set, else
   globally);
5. on `SIGINT` / `SIGTERM` it calls each module's `shutdown(ctx)`, stops the
   scheduler, writes pending data to disk and exits.

With `DRY_RUN=1` it stops after step 1, builds all command JSON, prints a
summary and exits with code 0.

## Adding a module

Create a folder, for example `src/modules/hello/`. Nothing else has to be edited:
the loader finds it, `/help` lists it and the commands are registered.

```
src/modules/hello/
  index.js
  commands/hello.js
locales/ar/hello.json
locales/en/hello.json   (both languages must have exactly the same keys)
test/hello.test.js
```

`index.js`:

```js
'use strict';

module.exports = {
  name: 'hello',                 // must equal the folder name; it is also the locale namespace
  commands: [require('./commands/hello')],
  events: [],                    // { event: Events.X, once?: true, execute(ctx, ...args) }
  components: [],                // { prefix: 'hello:', execute(interaction, ctx) }
  init: async (client, ctx) => {},     // optional, runs once the client is ready
  shutdown: async (ctx) => {},         // optional, runs on SIGINT / SIGTERM (5 s max)
  dashboard: { sections: [] }          // optional, see "Web dashboard" below
};
```

`commands/hello.js`:

```js
'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hello')                      // English, short, lowercase
    .setDescription('Say hello')           // fallback; real text comes from locales
    .addUserOption((o) => o.setName('member').setDescription('Who to greet')),
  cooldown: 3,                             // seconds per user (owners are exempt)
  botPermissions: [PermissionFlagsBits.SendMessages], // checked before execute, named in the error
  // dm: true,        allow the command in DMs (default: servers only)
  // ownerOnly: true, guild owner and OWNER_IDS only

  async execute(interaction, ctx) {
    const member = interaction.options.getUser('member') ?? interaction.user;
    await interaction.reply({
      embeds: [ctx.embeds.success(ctx.t(interaction, 'hello:greeting.title'), ctx.t(interaction, 'hello:greeting.text', { user: `${member}` }))]
    });
  }
};
```

`locales/en/hello.json`:

```json
{
  "commands": {
    "hello": {
      "description": "Dit bonjour",
      "options": { "member": "Qui saluer" }
    }
  },
  "greeting": { "title": "Bonjour", "text": "Bonjour {user} !" }
}
```

Localization keys used by `src/core/registry.js`:

| What | Key |
| --- | --- |
| command description | `<module>:commands.<name>.description` |
| option description | `<module>:commands.<name>.options.<option>` (a string) |
| option with choices | `...options.<option>.description` and `...options.<option>.choices.<value>` |
| subcommand / group | `...options.<sub>.description`, its options under `...options.<sub>.options` |

The two languages must have exactly the same keys: `npm test` and
`npm run check` fail otherwise. To make `/help` show a nice module name, add
`modules.<name>.name` and `modules.<name>.description` to
`locales/<lang>/core-commands.json`; without it the folder name is shown.

## The `ctx` object

Every command, event, component, `init` and `shutdown` receives the same `ctx`:

| Field | Use |
| --- | --- |
| `client` | the discord.js client |
| `store` | `store.guild(id)` / `store.global()`: `get(path, default)`, `set`, `update(path, fn, default)`, `delete` |
| `t` | `t(interactionOrGuildOrLang, 'namespace:key', vars)` |
| `i18n` | `has`, `raw`, `resolveLang`, `defaultLanguage`, `LANGUAGES` |
| `embeds` | `success`, `error`, `warn`, `info`, `base`: every reply is an embed |
| `permissions` | `isOwner`, `isWhitelisted`, `canModerate`, `botCan`, `botMissing`, `permissionLabel` |
| `logger` | `info`, `warn`, `error`, `debug`, `child(scope)` |
| `scheduler` | persistent timers: `on(type, fn)`, `schedule(type, runAt, payload)`, `cancel(id)`, `list` |
| `modlog` | `send(guild, category, embed)`: posts to the log channel (no-op without the logs module) |
| `modules` | every loaded module (used by `/help` and the dashboard) |
| `commandIds` | command name to Discord id, for clickable `</name:id>` mentions |

Other helpers live in `src/core/`: `confirm.js` (yes / no buttons), `paginate.js`
(short-lived page buttons), `duration.js` (`parse('2h30m')`, localized
`format(ms, target)`), `audit.js` (who did an action), `interactions.js`
(`memberHas`, `replyEphemeral`).

## Settings in the store

- Keep a module's guild settings under its own key: `hello.*`.
- If the module can be switched off, read the switch at `hello.enabled`.
- Values are plain JSON. Store IDs, never Discord objects.
- Do not keep references to values returned by `get()` and mutate them later:
  call `set` or `update`, which also schedules the save.
- Guild files are cached in memory and the least recently used ones are dropped
  every 10 minutes (they are saved first and re-read when needed).

## Components (buttons, select menus, modals)

The router sends an interaction to the component whose `prefix` starts its
`customId` (the longest prefix wins). Pick a unique prefix such as `hello:` and
put the state you need in the custom id, so the button still works after a
restart. Buttons are not covered by `default_member_permissions`: check
permissions again in the handler (`memberHas(interaction.member, [perm])`).

Collectors from `confirm.js` and `paginate.js` use the reserved prefixes
`confirm:` and `paginate:`. If a click matches no handler, the user is told the
menu expired.

## Errors

Throwing inside `execute` is fine: the router logs it and answers the user with
a localized message. Discord's "Missing Permissions" error (50013) names the
missing permissions when the command lists `botPermissions`. Shared strings
(errors, permission names, yes / no, durations) are in `locales/<lang>/common.json`.

## Web dashboard

A module with per-guild settings exports a `dashboard` schema. The dashboard
module renders it, validates the values and writes them with
`store.guild(id).set(path, value)`, so `path` must be exactly the path (and
`default` exactly the default) the module reads.

```js
dashboard: {
  sections: [{
    id: 'general',
    title: 'hello:dashboard.general.title',
    fields: [
      { path: 'hello.enabled', type: 'boolean', label: 'hello:dashboard.general.enabled', default: false },
      { path: 'hello.channel', type: 'channel', label: 'hello:dashboard.general.channel', default: null }
    ]
  }],
  actions: [{ id: 'reset', label: 'hello:dashboard.reset', danger: true, run: async (ctx, guild, userId) => 'hello:dashboard.resetDone' }]
}
```

Field types: `boolean`, `number`, `string`, `text`, `channel`, `role`, `channels`,
`roles`, `select`, `list`, `duration`.

## Limits to keep in mind

- Discord accepts at most 100 slash commands per application: prefer
  subcommands (`/hello add|remove|list`) to many top-level commands. The bot
  warns and registers the first 100 if there are more.
- Runtime dependencies are `discord.js` and `dotenv` only (music optionally
  uses `@discordjs/voice`, `prism-media` and `ffmpeg-static`, loaded lazily).
  No native addons.
- Memory: do not cache whole member lists or message histories in module state;
  fetch on demand and keep maps bounded.
- Files stay under about 400 lines, every user-visible string goes through `t`,
  comments explain why rather than what.

## Tests

Use `node:test` without connecting to Discord: test pure logic, check that
`data.toJSON()` works, and check locale parity for your namespace. Run one file
with `node --test test/hello.test.js`, everything with `npm test`.
