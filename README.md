<p align="center"><a href="https://aclclouds.com/en/bots?utm_source=github&utm_medium=readme&utm_campaign=free-multipurpose-discord-bot"><img src="https://raw.githubusercontent.com/ACL-Cloud/.github/main/profile/assets/aclclouds-logo.png" alt="ACLClouds" width="96" height="96"></a></p>

[Français](https://github.com/ACL-Cloud/bot-discord-francais-gratuit) · **English** · [Español](https://github.com/ACL-Cloud/bot-de-discord-espanol-gratis) · [Deutsch](https://github.com/ACL-Cloud/discord-bot-deutsch-kostenlos) · [Português](https://github.com/ACL-Cloud/bot-discord-portugues-gratis)

# ACLClouds Bot: free open-source multipurpose Discord bot

ACLClouds Bot is a free, open-source (MIT) multipurpose Discord bot built with discord.js v14 for Node.js 20+. One bot covers server protection (antiraid, antinuke with restoration of deleted channels and roles, automod with 11 filters, captcha verification), moderation with cases, logs, tickets with transcripts, role menus, server backups, music (24 web radios, audio links and files), levels, economy, giveaways, games and a built-in web dashboard, in Arabic and English. It runs in about 100 MB of RAM and can be hosted for free on [ACLClouds Discord bot hosting](https://aclclouds.com/en/bots?utm_source=github&utm_medium=readme&utm_campaign=free-multipurpose-discord-bot) (315 MB RAM, renewed for free every 4 days).

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](https://nodejs.org/)
[![discord.js v14](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org/)

**Hosting:** free hosting on ACLClouds, https://aclclouds.com/en/bots?utm_source=github&utm_medium=readme&utm_campaign=free-multipurpose-discord-bot ([step-by-step guide](#host-it-for-free-on-aclclouds)).

## Highlights

- **19 modules, 75 slash commands** (252 with subcommands), all in one bot. Discord's limit is 100 commands per application, so there is room to add your own.
- **Protection first:** antiraid (join waves, raid mode, lockdown, bot additions), antinuke (mass deletions, dangerous permissions, panic mode, restoration of deleted channels and roles) and automod (11 filters with strikes and escalation).
- **Two languages:** Arabic and English. Each server picks its own with `/config language`; command descriptions are translated in the Discord client too.
- **Configured from Discord or the browser:** `/setup` walks you through the basics; `/dashboard` sends a one-time login link to a web dashboard that covers every module.
- **Light:** only `discord.js` and `dotenv` are required. Caches are capped: about 100 MB of RAM measured on a live server. No database to install: settings are JSON files.
- **Music without scraping:** built-in web radios, direct audio links and uploaded files, played through ffmpeg (`ffmpeg-static` is installed with the bot). No YouTube or Spotify.
- **Survives restarts:** temporary bans, reminders, giveaways, raid mode and panic mode use persistent timers; buttons keep working after a restart.
- **Readable code:** plain CommonJS JavaScript, no build step, one folder per module. See [docs/DEVELOPING.md](docs/DEVELOPING.md).

## Contents

- [Features and commands](#features-and-commands)
- [Requirements](#requirements)
- [Create the Discord application](#create-the-discord-application)
- [Host it for free on ACLClouds](#host-it-for-free-on-aclclouds)
- [Run it on your computer or a VPS](#run-it-on-your-computer-or-a-vps)
- [First setup in Discord](#first-setup-in-discord)
- [Configuration reference](#configuration-reference)
- [Web dashboard](#web-dashboard)
- [Music](#music-1)
- [Security model](#security-model)
- [Data storage and backups](#data-storage-and-backups)
- [FAQ and troubleshooting](#faq-and-troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features and commands

Command names are the same in every language; their descriptions follow the language of your Discord client. The "Who can use it" column shows the default Discord permission. Server admins can change it per command in **Server Settings > Integrations > ACLClouds Bot**. Some commands also check rights in the bot itself (server owner, ticket staff, DJ role); this is noted in the table.

`<option>` is required, `[option]` is optional.

### General

Help, latency, bot information and per-server settings.

- `/help` is generated from the loaded modules, so a module you add shows up on its own.
- `/setup` is a short wizard with buttons: language, log channel, and which protections to turn on.
- `/config reset` wipes every setting of the server (with a confirmation).

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/help [command]` | List the commands of every module | Everyone |
| `/ping` | Show the bot latency | Everyone |
| `/botinfo` | Show information about the bot | Everyone |
| `/config language <value>` | Change the bot language on this server | Manage Server |
| `/config show` | Show the current settings | Manage Server |
| `/config reset` | Reset every setting of this server | Manage Server |
| `/setup` | Guided first-time setup of the bot | Manage Server |

### Antiraid

Detects join waves and suspicious accounts.

- **Join wave detection:** more than `join_threshold` joins within `join_window` seconds starts raid mode.
- **Raid mode:** new members are kicked, banned or timed out (`raid_action`) for `raid_duration` minutes. It can also punish the accounts of the wave itself (`punish_burst`) and lock the server automatically (`auto_lockdown`).
- **Filters at join:** minimum account age, no-avatar accounts, with their own action (`filter_action`). Members can receive a DM explaining why (`dm_notice`).
- **Anti-bot:** a bot added by someone who is not trusted is kicked, and the person who added it can be stripped of roles, kicked or banned (`bot_adder_action`). Verified bots can be allowed.
- **Lockdown:** `/lockdown start` denies `@everyone` in every public channel and saves the previous permissions; `/lockdown end` puts them back exactly.

Antiraid is off until you run `/antiraid enable` (or pick it in `/setup`).

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/antiraid status` | Show raid protection settings | Manage Server |
| `/antiraid enable` | Enable raid protection | Manage Server |
| `/antiraid disable` | Disable raid protection | Manage Server |
| `/antiraid set [join_threshold] [join_window] [raid_action] [timeout_minutes] [raid_duration] [punish_burst] [auto_lockdown] [min_account_age] [no_avatar] [filter_action] [anti_bot] [allow_verified_bots] [bot_adder_action] [dm_notice]` | Change raid protection settings | Manage Server |
| `/raidmode on [duration]` | Turn raid mode on | Manage Server |
| `/raidmode off` | Turn raid mode off | Manage Server |
| `/lockdown start [reason] [announce]` | Lock every public channel | Manage Channels |
| `/lockdown end` | Restore channel permissions as they were | Manage Channels |

### Antinuke

Stops a compromised admin or bot from wrecking the server. The bot reads the audit log to find who did each action and counts actions per member within a time window. One action over the limit triggers the protection.

| Watched action | Default limit |
| --- | --- |
| Channel deletion / creation | 1 / 4 per 60 s |
| Role deletion / creation | 1 / 4 per 60 s |
| Dangerous permission added to a role | 0 (first one triggers) |
| Role with dangerous permissions given to a member | 0 |
| Bans / kicks | 3 / 3 per 60 s |
| Member prune | 0 |
| Webhook creation | 2 per 60 s |
| Webhook spam | 10 messages per 5 s |
| Server name or icon change | 2 per 300 s |
| Vanity URL change | 0 |
| Emoji / sticker deletion | 3 / 2 per 60 s |

- **Punishments:** `strip` (remove roles, default), `quarantine` (replace roles with a quarantine role), `kick`, `ban` or `timeout`. `/antinuke release` gives the removed roles back.
- **Restoration:** deleted channels and roles are recreated with their settings, and permission changes are reverted (`restore`, on by default).
- **Panic mode:** when the protection triggers, the bot can switch to panic mode for 30 minutes (`auto_panic`, on by default): every untrusted action is treated as an attack. `/panic on` and `/panic off` control it by hand.
- **Trusted users:** the server owner, `OWNER_IDS` and members added with `/whitelist` are never punished.

Antinuke is off until the server owner runs `/antinuke enable`. Changing its settings, the whitelist and panic mode is reserved to the server owner and `OWNER_IDS`, even for administrators (see [Security model](#security-model)).

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/antinuke status` | Show nuke protection settings | Administrator |
| `/antinuke enable` | Enable nuke protection | Server owner / `OWNER_IDS` |
| `/antinuke disable` | Disable nuke protection | Server owner / `OWNER_IDS` |
| `/antinuke limit <action> <limit> [window]` | Set the limit of an action | Server owner / `OWNER_IDS` |
| `/antinuke punishment <type> [quarantine_role] [timeout_minutes]` | Choose the punishment | Server owner / `OWNER_IDS` |
| `/antinuke settings [restore] [auto_panic] [panic_minutes] [panic_strip_roles]` | Restore and panic options | Server owner / `OWNER_IDS` |
| `/antinuke release <user>` | Give back the roles removed from a member | Server owner / `OWNER_IDS` |
| `/antinuke quarantined` | List members whose roles were removed | Administrator |
| `/whitelist add <user>` | Trust a user or a bot | Server owner / `OWNER_IDS` |
| `/whitelist remove <user>` | Stop trusting a user | Server owner / `OWNER_IDS` |
| `/whitelist list` | Show trusted users | Administrator |
| `/panic on [minutes]` | Turn panic mode on | Server owner / `OWNER_IDS` |
| `/panic off` | Stop panic mode | Server owner / `OWNER_IDS` |

### Automod

Message filters, each with its own action and thresholds.

| Filter | On by default | Default action |
| --- | --- | --- |
| `invites` (Discord invites, your own server's can be allowed) | yes | delete |
| `mentions` (5 mentions or more) | yes | timeout 10 min |
| `spam` (6 messages in 5 s) | yes | timeout 5 min |
| `duplicates` (4 identical messages in 30 s) | yes | delete |
| `badwords` (your list, `*` wildcard) | no | delete |
| `links` (allowlist or denylist of domains) | no | delete |
| `attachments` (6 files in 15 s) | no | delete |
| `zalgo` | no | delete |
| `caps` (70 % capitals, 12 characters minimum) | no | delete |
| `emojis` (12 or more) | no | delete |
| `newlines` (20 lines or more) | no | delete |

- **Actions:** `delete`, `warn`, `timeout`, `kick` or `ban`.
- **Strikes and escalation:** each hit is a strike; by default 3 strikes within 24 h give a 10-minute timeout and 5 strikes a 1-hour timeout. Steps are editable with `/automod escalation`.
- **Exemptions:** roles and channels, for all filters or for one. Staff is ignored by default (`ignore_staff`).
- **Links:** in `allowlist` mode every link is blocked except allowed domains (Tenor, Giphy and Discord's CDN are allowed by default); in `denylist` mode only listed domains are blocked.
- `/automod test` shows which filters a text would trigger, without sending anything.

Automod is off until you run `/automod enable` (or pick it in `/setup`). It needs the Message Content intent.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/automod status` | Show the automod configuration | Manage Server |
| `/automod enable` | Turn automod on | Manage Server |
| `/automod disable` | Turn automod off | Manage Server |
| `/automod filter <filter> <enabled>` | Turn one filter on or off | Manage Server |
| `/automod action <filter> <action> [duration]` | Choose what a filter does | Manage Server |
| `/automod set <filter> [limit] [seconds] [percent] [min_length] [allow_own]` | Tune the thresholds of a filter | Manage Server |
| `/automod exempt <mode> [role] [channel] [filter]` | Exempt a role or channel, from all filters or from one | Manage Server |
| `/automod settings [notify] [ignore_staff] [strike_window]` | General automod settings | Manage Server |
| `/automod test <text>` | Check which filters a text would trigger | Manage Server |
| `/automod escalation add <strikes> <action> [duration]` | Add or replace a step | Manage Server |
| `/automod escalation remove <strikes>` | Remove a step | Manage Server |
| `/automod strikes view <user>` | Show the strikes of a member | Manage Server |
| `/automod strikes reset <user>` | Reset the strikes of a member | Manage Server |
| `/badwords add <words>` | Add words (comma separated, * = wildcard) | Manage Server |
| `/badwords remove <words>` | Remove words (comma separated) | Manage Server |
| `/badwords list` | Show the banned words (only to you) | Manage Server |
| `/badwords clear` | Remove every banned word | Manage Server |
| `/links allow <domain>` | Allow a domain and its subdomains | Manage Server |
| `/links deny <domain>` | Always block a domain and its subdomains | Manage Server |
| `/links remove <domain>` | Remove a domain from both lists | Manage Server |
| `/links mode <mode>` | Block every link except allowed ones, or only blocked ones | Manage Server |
| `/links list` | Show both lists | Manage Server |

### Moderation

Sanctions with numbered cases.

- Every sanction creates a case you can view, edit or delete. `/mod history` lists the cases of a user.
- Temporary bans (`/ban duration:`) are lifted on time, even after a restart.
- The member can receive a DM before the sanction, with an optional appeal text (`/mod config dm`, `/mod config appeal`). `silent:` skips the DM for one sanction.
- Warning thresholds sanction automatically (`/mod warnconfig`: timeout, kick, softban or ban). Warnings can expire (`/mod config warnexpiry`).
- `/purge` deletes up to 100 recent messages with filters (user, bots, humans, links, attachments, embeds, text).
- `/mod massban` bans a list of IDs at once, useful after a raid.
- Role hierarchy is checked: nobody can sanction someone with an equal or higher role.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/ban <user> [reason] [duration] [delete_messages] [silent]` | Ban a user, optionally for a limited time | Ban Members |
| `/case view <number>` | Show a case | Timeout Members |
| `/case edit <number> [reason] [duration]` | Change the reason or the length of a temporary ban | Timeout Members |
| `/case delete <number>` | Delete a case | Timeout Members |
| `/kick <user> [reason] [silent]` | Kick a member from the server | Kick Members |
| `/lock [channel] [reason]` | Prevent @everyone from talking in a channel | Manage Channels |
| `/mod clearwarns <user> [reason]` | Remove every active warning of a member | Timeout Members |
| `/mod config show` | Show the moderation settings | Manage Server |
| `/mod config dm <enabled> [show_moderator]` | DM members when they are sanctioned | Manage Server |
| `/mod config appeal [text]` | Text added to sanction DMs (how to appeal) | Manage Server |
| `/mod config reason <required>` | Require a reason for every sanction | Manage Server |
| `/mod config warnexpiry <duration>` | Warnings stop counting after this time | Manage Server |
| `/mod history <user> [type]` | Show every moderation case of a user | Timeout Members |
| `/mod massban <ids> [reason] [delete_messages]` | Ban many users at once by ID (raids) | Ban Members |
| `/mod nick <user> [nickname]` | Change or reset the nickname of a member | Manage Nicknames |
| `/mod softban <user> [reason] [delete_messages] [silent]` | Ban then unban a member to wipe their recent messages | Ban Members |
| `/mod unlock [channel] [reason]` | Unlock a channel locked with /lock | Manage Channels |
| `/mod untimeout <user> [reason]` | Remove the timeout of a member | Timeout Members |
| `/mod unwarn <case> [reason]` | Remove one warning by its case number | Timeout Members |
| `/mod warnconfig add <warns> <action> [duration]` | Add or replace a threshold | Manage Server |
| `/mod warnconfig remove <warns>` | Remove a threshold | Manage Server |
| `/mod warnconfig list` | Show the thresholds | Manage Server |
| `/mod warnings <user>` | List the active warnings of a member | Timeout Members |
| `/purge <amount> [user] [bots] [humans] [links] [attachments] [embeds] [contains]` | Delete recent messages, with optional filters | Manage Messages |
| `/slowmode <duration> [channel]` | Set the slowmode of a channel | Manage Channels |
| `/timeout <user> <duration> [reason] [silent]` | Time out a member (no messages, no voice) | Timeout Members |
| `/unban <user> [reason]` | Unban a user | Ban Members |
| `/warn <user> [reason] [silent]` | Warn a member (thresholds can sanction automatically) | Timeout Members |

### Logs

Sends events to the channels you choose, per category: `messages` (edits, deletions, bulk deletions), `members` (joins, leaves, nicknames, roles), `moderation`, `server` (channels, roles, emojis, server settings), `voice` (joins, leaves, moves), `invites` (which invite a new member used), `protection` (antiraid, antinuke, automod) and `tickets`. `all` sets every category at once. Channels can be ignored and bot messages are skipped unless you turn them on.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/logs set <category> <channel>` | Send a log category to a channel | Manage Server |
| `/logs disable <category>` | Stop logging a category | Manage Server |
| `/logs ignore <channel>` | Ignore a channel, or watch it again | Manage Server |
| `/logs bots <enabled>` | Log messages from bots or not | Manage Server |
| `/logs status` | Show the log configuration | Manage Server |

### Welcome

- Welcome and goodbye messages, as plain text or embed, in the channel of your choice.
- Optional private welcome message (DM).
- Variables: `{user}` (mention), `{username}`, `{displayname}`, `{userid}`, `{server}`, `{count}` (member count), `{created}` (account creation date).
- Autoroles, separately for humans and bots.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/welcome set <channel>` | Choose the welcome channel and enable | Manage Server |
| `/welcome message <text> [embed]` | Change the welcome message | Manage Server |
| `/welcome dm <enabled> [text]` | Private welcome message | Manage Server |
| `/welcome test` | Test the message on yourself | Manage Server |
| `/welcome show` | Show the welcome configuration | Manage Server |
| `/welcome disable` | Disable welcome messages | Manage Server |
| `/goodbye set <channel>` | Choose the goodbye channel and enable | Manage Server |
| `/goodbye message <text> [embed]` | Change the goodbye message | Manage Server |
| `/goodbye test` | Test the message on yourself | Manage Server |
| `/goodbye show` | Show the goodbye configuration | Manage Server |
| `/goodbye disable` | Disable goodbye messages | Manage Server |
| `/autorole add <role> [type]` | Add an autorole | Manage Roles |
| `/autorole remove <role> [type]` | Remove an autorole | Manage Roles |
| `/autorole list` | List autoroles | Manage Roles |

### Verification

A captcha with a button: the member clicks, a form shows a short code and asks them to type it back (4 to 8 characters, 6 by default, 3 attempts by default), and they get the verified role. Options: a role given until verification (`unverified_role`), an automatic kick of members who do not verify in time (`kick_after`, up to 7 days, off by default) and a custom panel text.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/verification setup <role> <channel> [kick_after] [unverified_role] [code_length] [attempts] [message]` | Configure verification and post the panel | Manage Server |
| `/verification panel` | Post the verification panel again | Manage Server |
| `/verification disable` | Disable verification | Manage Server |
| `/verification status` | Show the verification configuration | Manage Server |

### Tickets

- A panel with a button, or a menu when you create categories (each category can have its own Discord category and staff role).
- One private channel per ticket. Optional reason form when opening (`ask_reason`).
- Claim, add or remove members, rename, close with confirmation, reopen or delete.
- Transcript as a `.txt` file sent to the log channel and, optionally, to the member by DM.
- Optional rating requested from the member after closing. Limit of open tickets per member (1 by default, up to 10), channel name format (`ticket-{number}` by default) and welcome message.

`/ticket panel`, `/ticket config` and `/ticket category` need Manage Server; the other subcommands are for the ticket staff.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/ticket panel [channel] [title] [description]` | Post the ticket opening panel | Manage Server |
| `/ticket close [reason]` | Close the ticket of this channel | Ticket staff |
| `/ticket add <user>` | Add a member to this ticket | Ticket staff |
| `/ticket remove <user>` | Remove a member from this ticket | Ticket staff |
| `/ticket claim` | Claim this ticket (or release it) | Ticket staff |
| `/ticket rename <name>` | Rename the ticket channel | Ticket staff |
| `/ticket transcript` | Get the transcript of this ticket privately | Ticket staff |
| `/ticket config show` | Show the settings and statistics | Manage Server |
| `/ticket config staff <role> <action>` | Add or remove a staff role | Manage Server |
| `/ticket config logs [channel]` | Channel for logs and transcripts | Manage Server |
| `/ticket config parent [category]` | Discord category where tickets are created | Manage Server |
| `/ticket config limit <max>` | Maximum open tickets per member | Manage Server |
| `/ticket config options [ratings] [dm_transcript] [ask_reason] [owner_close] [name_format] [welcome_message]` | Ticket system options | Manage Server |
| `/ticket category add <name> [description] [emoji] [parent] [staff_role]` | Add a category | Manage Server |
| `/ticket category remove <name>` | Delete a category | Manage Server |
| `/ticket category list` | List categories | Manage Server |

### Roles

- Role menus with buttons or a select menu. Modes: `toggle`, `unique` (one role of the menu at a time), `add` only, `remove` only. A required role and a maximum number of roles can be set.
- `/role add` with a `duration` gives a temporary role, removed on time even after a restart.
- `/role all` gives or removes a role for every member, only humans or only bots.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/rolemenu create <name> <type> [mode] [title] [description] [required_role] [max]` | Create a role menu | Manage Roles |
| `/rolemenu add <menu> <role> [label] [emoji] [description] [style]` | Add a role to a menu | Manage Roles |
| `/rolemenu remove <menu> <role>` | Remove a role from a menu | Manage Roles |
| `/rolemenu edit <menu> [title] [description] [mode] [required_role] [clear_required] [max]` | Edit a menu | Manage Roles |
| `/rolemenu post <menu> [channel]` | Post a menu in a channel | Manage Roles |
| `/rolemenu list` | List role menus | Manage Roles |
| `/rolemenu delete <menu>` | Delete a menu and its messages | Manage Roles |
| `/role add <member> <role> [duration] [reason]` | Give a role, optionally temporary | Manage Roles |
| `/role remove <member> <role> [reason]` | Remove a role | Manage Roles |
| `/role all <role> <action> [target]` | Give or remove a role for the whole server | Manage Server |
| `/role info <role>` | Information about a role | Manage Roles |
| `/role temp [member]` | List running temporary roles | Manage Roles |

### Backups

Saves the server structure: roles (name, color, permissions, position), channels and categories with their permission overwrites (text, voice, announcement, stage and forum channels), and server settings (name, icon, verification level, content filter, notifications, AFK channel, system channel, `@everyone` permissions). Messages and members are not saved.

- `/backup load` asks for confirmation and shows progress. `replace` mode rebuilds the server to match the backup; `merge` mode only adds what is missing.
- Automatic backups every 6 hours to 30 days (`/backup auto 1d`, `off` to stop), keeping the last 3 by default.
- Backups are kept outside the server's own settings file, so they survive the server being wiped and can be loaded into a new server.

Every `/backup` subcommand is reserved to the server owner and `OWNER_IDS`.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/backup create [name]` | Back up the server now | Server owner / `OWNER_IDS` |
| `/backup list` | List backups | Server owner / `OWNER_IDS` |
| `/backup info <id>` | Details of a backup | Server owner / `OWNER_IDS` |
| `/backup load <id> [mode]` | Restore a backup on this server | Server owner / `OWNER_IDS` |
| `/backup delete <id>` | Delete a backup | Server owner / `OWNER_IDS` |
| `/backup auto <interval> [keep]` | Automatic backups | Server owner / `OWNER_IDS` |

### Music

Plays in voice channels: 24 built-in web radios, direct audio links and audio files attached to the command. Details and limits in [Music](#music-1).

- Queue with view, remove, move, clear and shuffle; loop off, track or queue; seek; volume from 0 to 150 %.
- `/nowplaying` shows a progress bar with control buttons.
- Optional DJ role: with a DJ role set, only DJs and members with Manage Server can skip, stop or change the queue of others. Members must be in the bot's voice channel to control it.
- The bot leaves after 2 minutes alone or idle, unless 24/7 mode is on; in 24/7 mode it rejoins and resumes the radio after a restart.

`/music config` and `/music reset` need Manage Server.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/loop <mode>` | Repeat the track or the queue | Everyone (DJ role if set) |
| `/music join` | Bring the bot into your voice channel | Everyone (DJ role if set) |
| `/music leave` | Disconnect the bot from voice | Everyone (DJ role if set) |
| `/music show` | Show the music settings | Everyone (DJ role if set) |
| `/music config [dj_role] [remove_dj_role] [max_queue] [default_volume] [stay_247] [announce] [announce_channel] [announce_here] [allow_files]` | Change the music settings | Manage Server |
| `/music reset` | Restore the default settings | Manage Server |
| `/nowplaying` | Show the current track with controls | Everyone (DJ role if set) |
| `/pause` | Pause the music | Everyone (DJ role if set) |
| `/play [url] [file] [next]` | Play an audio URL, a radio or a file | Everyone (DJ role if set) |
| `/queue view` | Show the queue | Everyone (DJ role if set) |
| `/queue remove <position>` | Remove a track from the queue | Everyone (DJ role if set) |
| `/queue move <from> <to>` | Move a track in the queue | Everyone (DJ role if set) |
| `/queue clear` | Clear the upcoming tracks | Everyone (DJ role if set) |
| `/queue shuffle` | Shuffle the queue | Everyone (DJ role if set) |
| `/radio [station] [next]` | Listen to a built-in web radio (no argument: the list) | Everyone (DJ role if set) |
| `/resume` | Resume the music | Everyone (DJ role if set) |
| `/seek <position>` | Go to a position in the track | Everyone (DJ role if set) |
| `/skip [to]` | Skip the current track | Everyone (DJ role if set) |
| `/stop` | Stop the music and clear the queue | Everyone (DJ role if set) |
| `/volume [level]` | Show or change the volume | Everyone (DJ role if set) |

### Community

- **Suggestions:** `/suggest` posts an idea with vote buttons, optionally anonymous, with a thread and a DM when its status changes. Staff accepts, denies, considers or marks as implemented, with a reason.
- **Starboard:** messages that reach a number of reactions are copied to a channel. Emoji, threshold and self-star are configurable.
- **Birthdays:** members save their date; the bot announces it at the hour you choose (with a UTC offset) and can give a role for the day.
- **Statistics channels:** voice channels renamed with live counts (members, humans, bots, boosts, boost tier, channels, roles). Discord allows 2 renames per channel every 10 minutes; the bot respects it.
- **Sticky messages:** a message kept at the bottom of a channel.
- **AFK:** `/afk` sets a status shown when someone mentions you; it is removed when you talk again.
- **Tags:** custom text answers created with a form and shown with `/tag use`.
- **Temporary voice channels:** joining a hub channel creates a personal voice channel; its owner renames it, sets a user limit, locks or hides it, and allows or kicks members from a panel with buttons. It is deleted when empty.
- **Auto-responder:** automatic replies to a trigger (`exact`, `contains`, `startswith` or `word`), optionally in one channel.

`/community` (stats, sticky, auto-responder), `/suggestion` and `/starboard` are staff commands; `/birthday config` needs Manage Server and `/tempvoice setup|remove|list` needs Manage Channels.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/afk [reason]` | Mark yourself as away (or come back) | Everyone |
| `/birthday set <day> <month> [year] [user]` | Save your birthday | Everyone |
| `/birthday remove [user]` | Remove a birthday | Everyone |
| `/birthday view [user]` | Show a member's birthday | Everyone |
| `/birthday list` | Upcoming birthdays on the server | Everyone |
| `/birthday config [enabled] [channel] [role] [clear-role] [hour] [utc-offset] [message]` | Configure birthday announcements (staff) | Manage Server |
| `/community stats add <type> [template] [category]` | Create a statistics channel | Manage Channels |
| `/community stats remove <channel> [delete]` | Stop a statistics channel | Manage Channels |
| `/community stats list` | List statistics channels | Manage Channels |
| `/community stats refresh` | Update the channels now | Manage Channels |
| `/community sticky set [channel]` | Create or edit the sticky message | Manage Messages |
| `/community sticky remove [channel]` | Remove the sticky message | Manage Messages |
| `/community sticky list` | List sticky messages | Manage Messages |
| `/community autoresponder add <trigger> <response> [match] [channel]` | Add an automatic reply | Manage Server |
| `/community autoresponder remove <id>` | Remove an automatic reply | Manage Server |
| `/community autoresponder list` | List automatic replies | Manage Server |
| `/community autoresponder test <message>` | Test which trigger would answer a message | Manage Server |
| `/starboard set <channel> [threshold] [emoji] [selfstar]` | Choose the starboard channel and rules | Manage Server |
| `/starboard ignore <channel>` | Ignore or include a channel again | Manage Server |
| `/starboard disable` | Disable the starboard | Manage Server |
| `/starboard status` | Show the starboard settings | Manage Server |
| `/suggest <idea> [anonymous]` | Suggest an idea for the server | Everyone |
| `/suggestion accept <id> [reason]` | Accept a suggestion | Manage Messages |
| `/suggestion deny <id> [reason]` | Deny a suggestion | Manage Messages |
| `/suggestion consider <id> [reason]` | Mark a suggestion as under consideration | Manage Messages |
| `/suggestion implement <id> [reason]` | Mark a suggestion as implemented | Manage Messages |
| `/suggestion delete <id>` | Delete a suggestion and its message | Manage Messages |
| `/suggestion list [status]` | List suggestions | Manage Messages |
| `/suggestion config [channel] [anonymous] [threads] [dm] [cooldown]` | Configure suggestions | Manage Messages |
| `/tag use <name> [user]` | Show a tag | Everyone |
| `/tag create <name>` | Create a tag | Everyone |
| `/tag edit <name>` | Edit a tag | Everyone |
| `/tag delete <name>` | Delete a tag | Everyone |
| `/tag info <name>` | Tag details | Everyone |
| `/tag list` | List tags | Everyone |
| `/tempvoice setup [category] [name]` | Create a "join to create" channel | Manage Channels |
| `/tempvoice remove <hub> [delete]` | Remove a hub channel | Manage Channels |
| `/tempvoice list` | Show hub channels and active channels | Manage Channels |
| `/tempvoice panel` | Show the control panel of your channel | Everyone |

### Levels

XP per message with a cooldown, `/rank` with a text progress bar, `/leaderboard`, level-up announcements (in the channel of your choice or off) and role rewards per level. Off until you run `/levels enable`.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/rank [user]` | Show your level and rank | Everyone |
| `/leaderboard` | Show the most active members | Everyone |
| `/levels enable` | Turn on XP for messages (Manage Server) | Manage Server |
| `/levels disable` | Turn off XP for messages (Manage Server) | Manage Server |
| `/levels config [channel] [announce] [cooldown] [xp_min] [xp_max]` | Show or change the settings (Manage Server) | Manage Server |
| `/levels reset <user>` | Reset the XP of a member (Manage Server) | Manage Server |
| `/levels reward-add <level> <role>` | Give a role when a level is reached (Manage Server) | Manage Server |
| `/levels reward-remove <level>` | Remove the role reward of a level (Manage Server) | Manage Server |
| `/levels reward-list` | List the role rewards | Everyone |

### Economy

Wallet and bank, daily and weekly rewards, `/work` once an hour, payments between members, robbery with a failure chance, a shop whose items can give a role, inventory, richest members, and three games with bets: coin flip, slots and blackjack (with buttons). Currency name, symbol and amounts are set with `/eco config`.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/balance [user]` | Show your wallet and bank balance | Everyone |
| `/work` | Work for some money (once an hour) | Everyone |
| `/pay <user> <amount>` | Give coins from your wallet to another member | Everyone |
| `/bank deposit <amount>` | Move coins from your wallet to your bank | Everyone |
| `/bank withdraw <amount>` | Move coins from your bank to your wallet | Everyone |
| `/shop list` | List the shop items | Everyone |
| `/shop buy <item>` | Buy an item | Everyone |
| `/shop add <name> <price> [description] [role]` | Add an item to the shop (Manage Server) | Manage Server |
| `/shop remove <item>` | Remove an item from the shop (Manage Server) | Manage Server |
| `/gamble coinflip <amount> <side>` | Bet on heads or tails (50/50) | Everyone |
| `/gamble slots <amount>` | Spin the slot machine | Everyone |
| `/gamble blackjack <amount>` | Play blackjack against the dealer | Everyone |
| `/eco daily` | Claim your daily reward | Everyone |
| `/eco weekly` | Claim your weekly reward | Everyone |
| `/eco rob <user>` | Try to rob another member (risky) | Everyone |
| `/eco inventory` | Show the items you bought | Everyone |
| `/eco richest` | Show the richest members | Everyone |
| `/eco config [currency] [symbol] [daily] [weekly] [work_min] [work_max] [rob_fail]` | Show or change the settings (Manage Server) | Manage Server |

### Giveaways

Button entry, several winners, requirements (a role, a minimum account age in days), reroll and cancel. Giveaways end on time even after a restart. Every subcommand needs Manage Server.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/giveaway start <prize> <duration> [winners] [channel] [role] [min_account_days]` | Start a giveaway | Manage Server |
| `/giveaway end <id>` | End a giveaway now and draw winners | Manage Server |
| `/giveaway reroll <id>` | Draw new winners for an ended giveaway | Manage Server |
| `/giveaway cancel <id>` | Cancel a giveaway without winners | Manage Server |
| `/giveaway list` | List recent giveaways | Manage Server |

### Fun and games

Two-player games with buttons (tic-tac-toe, Connect 4), rock-paper-scissors against the bot or a member, hangman, trivia rounds with a built-in question bank in each language, 8-ball, dice and small text commands.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/8ball <question>` | Ask the magic 8-ball a question | Everyone |
| `/dice [sides] [count]` | Roll one or more dice | Everyone |
| `/game tictactoe <opponent>` | Play tic-tac-toe with another member | Everyone |
| `/game connect4 <opponent>` | Play Connect 4 with another member | Everyone |
| `/game rps [opponent]` | Play rock-paper-scissors against the bot or a member | Everyone |
| `/game hangman` | Play hangman alone | Everyone |
| `/game trivia [count]` | Answer a trivia round | Everyone |
| `/fun choose <options>` | Let the bot pick one option for you | Everyone |
| `/fun ship <first> <second>` | Compute the love compatibility of two members | Everyone |
| `/fun reverse <text>` | Reverse a text | Everyone |
| `/fun emojify <text>` | Turn a text into regional-indicator emoji letters | Everyone |

### Utility

Information about members, the server, roles, channels and avatars; an invite leaderboard (from the logs module's invite tracker); polls with buttons, live counts and an end time; reminders; `/say`; an embed builder with a form; `/snipe` to see a recently deleted message. Snipe is off by default for privacy and is turned on with `/snipe enable`.

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/info user [user]` | Show information about a member | Everyone |
| `/info server` | Show information about this server | Everyone |
| `/info avatar [user]` | Show a member's avatar at full size | Everyone |
| `/info role <role>` | Show information about a role | Everyone |
| `/info channel [channel]` | Show information about a channel | Everyone |
| `/info members` | Count the members of this server | Everyone |
| `/info invites [user]` | Leaderboard of the members who invited the most people | Everyone |
| `/poll <question> <options> [duration]` | Start a poll with buttons and live counts | Everyone |
| `/remind <delay> <text>` | Be reminded of something later | Everyone |
| `/say <message> [channel]` | Make the bot post a message | Manage Messages |
| `/embed [channel]` | Write and post an embed with a form | Manage Messages |
| `/snipe show [channel] [index]` | Show a recently deleted message | Manage Messages |
| `/snipe enable` | Keep deleted messages for /snipe (Manage Server) | Manage Server |
| `/snipe disable` | Stop keeping deleted messages (Manage Server) | Manage Server |

### Dashboard

`/dashboard` replies (only to you) with a personal login link to the web dashboard. See [Web dashboard](#web-dashboard).

| Command | What it does | Who can use it |
| --- | --- | --- |
| `/dashboard` | Open the server's web dashboard | Manage Server |

## Requirements

- **Node.js 20 or newer** (20, 22 and 24 work). No build step and no native addons to compile.
- **About 100 MB of RAM** for the bot itself (95 to 115 MB measured live). Each music stream adds an ffmpeg process of about 27 MB.
- A Discord account and an application with a bot token ([next section](#create-the-discord-application)).
- For the web dashboard: a port reachable from your browser.

## Create the Discord application

You do this once, whatever the host.

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and log in.
2. Click **New Application**, give it a name (this is the bot's name), accept the terms and click **Create**.
3. On **General Information**, copy the **Application ID**. You need it for the invite link.
4. Open the **Bot** tab:
   - Click **Reset Token**, confirm, and copy the token. This is `DISCORD_TOKEN`. Anyone who has it controls your bot: never post it, never commit it. If it leaks, reset it again.
   - Under **Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**, then click **Save Changes**. **Presence Intent** is not needed.
   - Optional: turn off **Public Bot** if only you should be able to invite it.
5. Invite the bot to your server with this link, after replacing `APPLICATION_ID`:

   ```text
   https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot%20applications.commands&permissions=1410782588150
   ```

   You can also build it in **OAuth2 > URL Generator**: tick the `bot` and `applications.commands` scopes, then the permissions below. You need the Manage Server permission on the server you invite it to.

**Why these intents.** Server Members lets the bot see joins and leaves (welcome, antiraid, autoroles, verification, member logs). Message Content lets it read messages (automod, banned words, auto-responder, message logs). If one is off, the bot does not crash: it prints in the console which intent is missing and which features are inactive, and starts without it.

**Which permissions.** `1410782588150` grants exactly what the modules use: View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Embed Links, Attach Files, Read Message History, Add Reactions, Manage Messages, Manage Channels, Manage Roles, Manage Webhooks, Manage Server, Manage Expressions, Manage Nicknames, View Audit Log, Kick Members, Ban Members, Timeout Members, Connect, Speak and Move Members.

**Administrator alternative.** The link the bot prints in its console at startup uses `permissions=8` (Administrator). It is simpler: the protections can always act and restore what was deleted, and you never hit a missing channel permission. The trade-off is that a leaked token gives full control of the server. With the detailed list, the bot can still be blocked by channel overwrites, and the commands tell you which permission is missing when that happens.

In both cases, **move the bot's role above the roles it must manage** (Server Settings > Roles). Discord does not let a bot act on a member or role placed above its own highest role.

## Host it for free on ACLClouds

[ACLClouds](https://aclclouds.com) offers a free Discord bot plan. The bot was built to fit in it.

| Free bot plan | |
| --- | --- |
| RAM | 315 MB |
| CPU | 0.25 vCPU |
| Storage | 715 MB |
| Upload | .zip up to 100 MB |
| Renewal | free, every 4 days, possible during the last 2 days |
| Isolation | each bot runs in its own gVisor sandbox |
| Node.js | 20, 22 or 24 (22 by default) |

### 1. Create your account

Go to [aclclouds.com](https://aclclouds.com) and create an account, or log in if you have one.

### 2. Create the free bot

1. In your client area, open **Discord bots**, then click **Create a bot**. This opens the order page with the bot category selected.
2. Pick the **Free offer** (it shows "Renewal every 4 days").
3. Choose the **Node.js** technology.
4. Enter a **Service name** (for example "ACLClouds Bot"). It only helps you find the bot in your panel.
5. Click **Create for free**. No payment is required. An account can have one free service per category.

The bot's page opens on the **Console** tab. The other tabs you will use are **Files**, **Startup**, **Deployments** and **Settings**.

### 3. Put the bot's code on it

Pick one of the two ways.

**A. Upload a .zip**

1. Download this repository (on GitHub: **Code > Download ZIP**, or `git clone`).
2. Make a .zip whose root contains `package.json`, `package-lock.json`, `index.js`, `src/` and `locales/`. Leave out `node_modules/` (dependencies are installed on the server), `.env` and `data/`.
3. In the **Deployments** tab, drag the .zip (or the folder) onto the drop area, or click **Choose a .zip file**. The limit is 100 MB; this bot is far below it without `node_modules`.

**B. Connect GitHub**

1. Fork this repository, or push it to your own GitHub repository.
2. In the **Settings** tab, find the GitHub section. Enter the repository URL (`https://github.com/owner/repository`) and the branch, or connect your GitHub account to pick public and private repositories from a list.
3. Each deployment fetches the latest version of the branch. You can also turn on automatic deployment on every push.

### 4. Set the token and the variables

Open the **Startup** tab.

1. **Discord bot token:** paste the token from the Developer Portal and save. It is stored encrypted as the `DISCORD_TOKEN` variable and never shown again.
2. **Start command:** leave it empty. The panel detects `npm start` from `package.json`, which runs `node index.js`.
3. **Version:** Node.js 22 is the default and works. 20 and 24 work too.
4. **Environment variables:** add the optional ones you want (see [Configuration reference](#configuration-reference)). Most useful here:
   - `DEFAULT_LANGUAGE` = `ar` or `en` (the default is `en`);
   - `OWNER_IDS` = your Discord user ID;
   - `GUILD_ID` = your server ID while you test, so commands appear immediately.

   Do not set `PORT`, `SERVER_PORT` or `DASHBOARD_PORT` here: the panel provides the port when you assign one (step 6).

Variables apply at the next start.

### 5. Start the bot and read the console

1. Open the **Console** tab and click **Start**.
2. The first start shows **Installing dependencies**: the panel runs `npm ci` from `package-lock.json`, which also installs the music packages. Then the bot starts. Inside the gVisor sandbox, startup takes a few seconds more than on a regular server.
3. You should see these lines (in the language of `DEFAULT_LANGUAGE`):

   ```text
   Starting ACLClouds Bot (19 modules, 75 commands)…
   Logged in as YourBot#1234, present on 1 server(s).
   Invite link for the bot: https://discord.com/oauth2/authorize?client_id=...
   ```

4. If the bot is not on your server yet, open the invite link (or the one from [Create the Discord application](#create-the-discord-application)).

If the console shows an error instead, see [FAQ and troubleshooting](#faq-and-troubleshooting). The most common one at this stage is a missing privileged intent, and the console explains how to enable it.

### 6. Turn on the web dashboard (optional)

The bot's dashboard needs a public port. A Discord bot alone does not.

1. In the **Startup** tab, find the **Port / Address** panel and click **Assign a port**. Leave the field empty to get the first free port, or type one in the range shown.
2. The bot restarts. The panel gives it the `PORT` and `SERVER_PORT` variables, and the bot's dashboard listens on that port automatically. Do not add these variables yourself.
3. The panel now shows two addresses:
   - **HTTPS address**, of the form `https://<name>-<8 characters>.aclclouds.online`. ACLClouds provides the certificate and forwards the requests to the bot's port, with the `Host` and `X-Forwarded-*` headers. Use this one.
   - **Public address**, an `IP:port` pair. It works too, in plain HTTP, which is fine for a quick test.
4. Optional: in **Environment variables**, set `DASHBOARD_URL` to the HTTPS address (for example `https://mybot-1a2b3c4d.aclclouds.online`) and restart the bot. Without it, the bot learns the address the first time you open the HTTPS address in your browser, and the console prints `Web dashboard online on port ...` at startup either way.
5. Leave `TRUST_PROXY` at its default (`true`): the HTTPS address goes through the ACLClouds proxy, and the bot needs its forwarded headers.
6. In Discord, run `/dashboard` and open the link.

For "log in with Discord", add the HTTPS address followed by `/auth/callback` as a redirect in the Developer Portal (see [Web dashboard](#web-dashboard)).

### 7. Keep it online

- **Renewal:** the free bot is renewed for free every 4 days. Renewal opens in the last 2 days before the due date: go to the **Settings** tab and click **Renew**. A bot that is not renewed is suspended until you renew it.
- **Updates:** upload a new .zip in **Deployments**, or push to your branch if GitHub is connected. Before replacing the code, download the `data/` folder from the **Files** tab to keep a copy of your settings.
- **Dependencies:** after changing `package.json`, use **Reinstall dependencies** in the **Startup** tab.
- **Files and SFTP:** the **Files** tab and the **SFTP** tab give access to the bot's files, including `data/`.

## Run it on your computer or a VPS

```bash
git clone https://github.com/ACL-Cloud/free-multipurpose-discord-bot.git aclclouds-bot
cd aclclouds-bot
npm install
cp .env.example .env    # then edit .env and set DISCORD_TOKEN
npm start
```

On Windows, copy `.env.example` to `.env` with the file explorer or `copy .env.example .env`.

`npm install` also installs the optional music packages (`@discordjs/voice`, `prism-media`, `ffmpeg-static`). If they cannot be installed, the bot starts without the music module and says so in the console.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm start` | starts the bot |
| `npm test` | unit tests, without connecting to Discord |
| `npm run check` | checks that modules load, that the five languages have the same keys and that the command JSON is valid |
| `npm run dry-run` | loads every module and builds the commands, then exits |

### Keep it running with pm2

```bash
npm install -g pm2
pm2 start index.js --name aclclouds-bot
pm2 save
pm2 startup     # prints the command that starts pm2 at boot
```

`pm2 logs aclclouds-bot` shows the console, `pm2 restart aclclouds-bot` restarts it.

### Keep it running with systemd

Create `/etc/systemd/system/aclclouds-bot.service` (adjust the user and the path):

```ini
[Unit]
Description=ACLClouds Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aclbot
WorkingDirectory=/opt/aclclouds-bot
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aclclouds-bot
journalctl -u aclclouds-bot -f
```

The `.env` file is read from `WorkingDirectory`. On `SIGTERM` (sent by `systemctl stop`, pm2 and most panels), the bot saves its data before exiting.

## First setup in Discord

1. Run `/setup` on your server. The wizard has three steps: the bot's language on this server, a log channel, and the protections to turn on (antiraid, antinuke, automod). Each step can be skipped.
2. Move the bot's role above the members' roles (Server Settings > Roles), otherwise protections and sanctions cannot act on them.
3. Run `/help` to see every module and command, and `/config show` to review the settings.
4. Optional: run `/dashboard` to continue in the browser.
5. If you use antinuke, run `/antinuke enable` as the server owner and add trusted bots and admins with `/whitelist add`.

## Configuration reference

Only secrets and startup options go in `.env` (or in your host's environment variables). Everything else is set per server with commands or the dashboard.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | yes | | Bot token (Developer Portal > Bot > Reset Token). |
| `GUILD_ID` | no | empty | Registers the commands on this server only, where they appear immediately. Empty: global registration on every server, which Discord can take up to an hour to show. |
| `DEFAULT_LANGUAGE` | no | `en` | Language of the console and of servers that never ran `/config language`: `ar` or `en`. |
| `OWNER_IDS` | no | empty | Comma-separated user IDs treated as bot owners on every server: they pass the protections and can use owner-only commands. |
| `LOG_LEVEL` | no | `info` | Console detail: `debug`, `info`, `warn` or `error`. |
| `DATA_DIR` | no | `./data` | Folder where settings are saved. |
| `DASHBOARD_PORT` | no | empty | Port of the web dashboard. `PORT` and `SERVER_PORT`, set by most hosting panels, are used when it is empty. If none is set, the dashboard is off. |
| `DASHBOARD_URL` | no | empty | Public address of the dashboard, used in login links and for the OAuth2 redirect. When empty, the bot learns it from the first request that comes through a reverse proxy (not from an IP address). |
| `DISCORD_CLIENT_SECRET` | no | empty | OAuth2 client secret (Developer Portal > OAuth2). Adds "log in with Discord" to the dashboard. Secret. |
| `DISCORD_CLIENT_ID` | no | application ID | OAuth2 client ID, only if it differs from the bot's application. |
| `DASHBOARD_SECRET` | no | generated | 16+ random characters used to sign dashboard sessions. If empty, one is generated and kept in `data/global.json`. |
| `TRUST_PROXY` | no | `true` | Trust `X-Forwarded-*` headers from a reverse proxy. Set to `0` when the dashboard port is exposed directly. `DASHBOARD_TRUST_PROXY` is accepted too. |
| `DRY_RUN` | no | empty | `1` loads the modules and builds the commands without connecting to Discord, then exits. |

## Web dashboard

The dashboard is a small web server inside the bot (Node's `http` module, no framework). It shows every module that has settings, with forms checked on the server, and buttons for actions such as starting raid mode, testing the welcome message or creating a backup.

**Turning it on.** Set `DASHBOARD_PORT` (or let your host set `PORT`), then set `DASHBOARD_URL` to the address people open in their browser. On ACLClouds, follow [step 6](#6-turn-on-the-web-dashboard-optional).

**Logging in with a magic link.** `/dashboard` (Manage Server) replies only to you with a link. The link is single use, valid for 10 minutes and tied to you and to that server. The session then lasts 7 days in that browser. No password, no OAuth setup needed.

**Logging in with Discord (optional).**

1. In the Developer Portal, open **OAuth2**, click **Reset Secret** and copy the client secret into `DISCORD_CLIENT_SECRET`.
2. Under **Redirects**, add `DASHBOARD_URL` followed by `/auth/callback`, for example `https://bot.example.com/auth/callback`, and save.
3. Restart the bot. The login page offers to log in with Discord (scopes `identify` and `guilds`).

**Who gets in.** The server owner, `OWNER_IDS`, and members with Manage Server. This is checked again on every request (cached 60 seconds), so removing someone's permission removes their access. Antinuke settings and actions are reserved to the owner, as in Discord.

**Protections.** Login links and session IDs are stored only as hashes. Forms are protected against cross-site requests, login attempts are rate-limited and responses carry a strict Content Security Policy.

**HTTPS on a VPS.** Put a reverse proxy in front, for example Caddy:

```text
bot.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

with `DASHBOARD_PORT=3000` and `DASHBOARD_URL=https://bot.example.com`. Keep `TRUST_PROXY` at its default when a proxy is in front, and set it to `0` when the port is exposed directly.

## Music

- **Sources:** direct links to audio files and streams (`.mp3`, `.ogg`, `.opus`, `.flac`, `.wav`, `.m4a`, `.aac`, `.webm`, `.mp4` and more), `.m3u` and `.pls` playlists, web radio streams, and audio files attached to `/play file:` (can be turned off with `/music config allow_files:`). HLS streams (segmented `.m3u8`) are not supported.
- **No YouTube, no Spotify.** Downloading from these services breaks their terms of service, so the bot does not do it.
- **ffmpeg is included.** `ffmpeg-static` ships an ffmpeg binary and is installed by `npm install`, so there is nothing to install on the system. The bot downloads the audio itself and pipes it to ffmpeg, which lets it refuse private and local network addresses, follow redirects safely and reconnect to radios.
- **Built-in radios (`/radio`):** Radio Paradise (Main, Mellow, Rock and Global mixes), FIP (main, Jazz, Rock, Electro, Monde, Hip-Hop, Metal, Pop, Reggae), Radio Swiss Jazz, Radio Swiss Classic, Radio Swiss Pop, Venice Classic Radio, KEXP 90.3 Seattle, WFMU Freeform Radio, Radio Meuh, Nightwave Plaza, Nightride FM (main, Chillsynth, Darksynth). `/radio` without an argument lists them; the `station` option autocompletes by name or genre.
- **Volume** is applied by ffmpeg, from 0 to 150 %.
- If the music packages are missing, the music commands are not registered and the console says which package could not be loaded. The rest of the bot works normally.

## Security model

- **Owners:** the server owner and the users listed in `OWNER_IDS`. They are never punished by the protections and can use owner-only commands.
- **Whitelist:** trusted users and bots added with `/whitelist add` (server owner only). Antinuke ignores them. Keep this list short: a trusted account that gets compromised is not stopped.
- **Owner-only antinuke:** turning antinuke on or off, changing its limits or punishment, the whitelist and panic mode are reserved to the owners, even for members with Administrator. A compromised admin account therefore cannot turn the protection off or trust itself first. The dashboard applies the same rule.
- **Backups** are owner-only too, because loading one can rebuild or wipe the whole server.
- **Discord permissions** decide who sees the other commands (`default_member_permissions`). Buttons and menus check permissions again when clicked.
- **Role hierarchy** is checked before any sanction.
- **No telemetry.** The bot only talks to Discord, plus the audio URLs and radios that members ask to play.
- **Secrets** stay in `.env` or your host's encrypted variables. `.env` and `data/` are in `.gitignore`.

## Data storage and backups

- Settings live in JSON files in `data/` (or `DATA_DIR`): one file per server (`<server ID>.json`) and `global.json` for data shared by all servers (server backups, persistent timers, dashboard sessions).
- Writes are delayed by about a second and atomic (written to a temporary file, then renamed), so a crash never leaves a half-written file. Data is also saved on `SIGINT` and `SIGTERM`.
- Files of inactive servers are dropped from memory after a while and read again when needed.
- **Back up `data/`** to keep your settings: copy the folder while the bot is stopped, or at any time since files are replaced atomically. Restoring means putting the folder back before starting the bot.
- **Server backups** (`/backup`) are a different thing: a copy of a Discord server's roles and channels, stored in `global.json`.

## FAQ and troubleshooting

**The console says "Used disallowed intents" or that privileged intents are not enabled.**
Enable **Server Members Intent** and **Message Content Intent** in the Developer Portal (your application > **Bot** > **Privileged Gateway Intents**), click **Save Changes** and restart the bot. Until then, the bot starts without them and lists the inactive features. A bot in 100 servers or more must be verified by Discord to keep these intents.

**Slash commands do not appear.**
Without `GUILD_ID`, commands are registered globally and Discord can take up to an hour to show them. Set `GUILD_ID` to your server ID to see them at once (you can remove it later). Also check that the bot was invited with the `applications.commands` scope: if not, open the invite link again. Pressing Ctrl+R in the Discord client reloads the command list.

**"Discord refused to register commands on server ..."**
`GUILD_ID` is wrong, or the bot is not on that server, or it was invited without `applications.commands`.

**"Discord rejected the token".**
The token was mistyped or reset. Reset it in the Developer Portal and replace `DISCORD_TOKEN`.

**A command answers that a permission is missing.**
The reply names the permission. Give it to the bot's role, check channel overwrites, and make sure the bot's role is above the roles or members it must act on.

**The music does not play.**
- Check the console at startup: if the music module is disabled, it names the missing package. Run `npm install` again (on ACLClouds: **Reinstall dependencies** in the **Startup** tab).
- The bot needs Connect and Speak in the voice channel, and you must be in that channel.
- The link must point to an audio file or stream, not to a web page. YouTube and Spotify links are refused.
- Some radios block some regions or go offline. Try another station from `/radio`.

**`/dashboard` says the dashboard is not enabled or its address is unknown.**
Set a port (`DASHBOARD_PORT`, or `PORT` from your host) and `DASHBOARD_URL`, then restart. On ACLClouds, see [step 6](#6-turn-on-the-web-dashboard-optional).

**"Log in with Discord" fails with an invalid redirect.**
The redirect in the Developer Portal must be exactly `DASHBOARD_URL` + `/auth/callback`, with the same scheme (`http` or `https`) and port.

**How do I change the language?**
`/config language` per server. `DEFAULT_LANGUAGE` sets the console language and the default for new servers.

**Can I remove a module?**
Yes: delete its folder in `src/modules/`. The loader, `/help` and the dashboard adapt on their own.

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/DEVELOPING.md](docs/DEVELOPING.md), which explains how the bot starts, how to add a module, the `ctx` object, translations and tests.

## License

[MIT](LICENSE), © ACLClouds.

---

Hosted for free on [ACLClouds](https://aclclouds.com).
