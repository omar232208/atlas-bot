'use strict';

const { ChannelType } = require('discord.js');
const { SETTINGS, COLLECTIONS } = require('./config');
const stats = require('./stats');
const TV = require('./tempvoice');

const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const k = (key) => `community:dashboard.${key}`;

/**
 * Builds a field; the default always comes from SETTINGS so the dashboard and
 * the code can never disagree.
 */
const field = (path, type, key, extra = {}) => ({ path, type, label: k(`fields.${key}.label`), help: k(`fields.${key}.help`), default: SETTINGS[path], ...extra });

const section = (id, fields) => ({ id, title: k(`${id}.title`), description: k(`${id}.description`), fields });

/**
 * Settings schema consumed by the web dashboard module.
 */
const dashboard = {
  sections: [
    section('suggestions', [
      field('community.suggestions.channelId', 'channel', 'suggestionsChannel', { channelTypes: TEXT }),
      field('community.suggestions.anonymous', 'boolean', 'suggestionsAnonymous'),
      field('community.suggestions.threads', 'boolean', 'suggestionsThreads'),
      field('community.suggestions.dmUpdates', 'boolean', 'suggestionsDm'),
      field('community.suggestions.cooldown', 'number', 'suggestionsCooldown', { min: 0, max: 86400 })
    ]),
    section('starboard', [
      field('community.starboard.enabled', 'boolean', 'starboardEnabled'),
      field('community.starboard.channelId', 'channel', 'starboardChannel', { channelTypes: TEXT }),
      field('community.starboard.threshold', 'number', 'starboardThreshold', { min: 1, max: 100 }),
      field('community.starboard.emoji', 'string', 'starboardEmoji', { maxLength: 64 }),
      field('community.starboard.selfStar', 'boolean', 'starboardSelfStar'),
      field('community.starboard.ignoredChannels', 'channels', 'starboardIgnored', { channelTypes: TEXT })
    ]),
    section('birthdays', [
      field('community.birthdays.enabled', 'boolean', 'birthdaysEnabled'),
      field('community.birthdays.channelId', 'channel', 'birthdaysChannel', { channelTypes: TEXT }),
      field('community.birthdays.roleId', 'role', 'birthdaysRole'),
      field('community.birthdays.hour', 'number', 'birthdaysHour', { min: 0, max: 23 }),
      field('community.birthdays.utcOffset', 'number', 'birthdaysOffset', { min: -12, max: 14 }),
      field('community.birthdays.message', 'text', 'birthdaysMessage', { maxLength: 500 })
    ]),
    section('afk', [
      field('community.afk.enabled', 'boolean', 'afkEnabled'),
      field('community.afk.nickname', 'boolean', 'afkNickname')
    ]),
    section('tags', [
      field('community.tags.managerRoleId', 'role', 'tagsManager')
    ]),
    section('sticky', [
      field('community.sticky.delay', 'number', 'stickyDelay', { min: 2, max: 60 })
    ]),
    section('tempvoice', [
      field('community.tempvoice.defaultLimit', 'number', 'tempvoiceLimit', { min: 0, max: 99 }),
      field('community.tempvoice.nameTemplate', 'string', 'tempvoiceName', { maxLength: 100 })
    ]),
    section('autoresponder', [
      field('community.autoresponder.enabled', 'boolean', 'autoresponderEnabled'),
      field('community.autoresponder.cooldown', 'number', 'autoresponderCooldown', { min: 0, max: 3600 })
    ])
  ],
  actions: [
    {
      id: 'refreshStats',
      label: k('actions.refreshStats.label'),
      async run(ctx, guild) {
        if (!stats.hasStats(ctx, guild.id)) return k('actions.refreshStats.none');
        const { waiting } = await stats.refresh(ctx, guild);
        return k(waiting ? 'actions.refreshStats.waiting' : 'actions.refreshStats.done');
      }
    },
    {
      id: 'clearAfk',
      label: k('actions.clearAfk.label'),
      danger: true,
      async run(ctx, guild) {
        // Nicknames keep their "[AFK]" tag: renaming many members at once would hit
        // rate limits, and members can rename themselves.
        ctx.store.guild(guild.id).set(COLLECTIONS.afk, {});
        return k('actions.clearAfk.done');
      }
    },
    {
      id: 'cleanupTempvoice',
      label: k('actions.cleanupTempvoice.label'),
      async run(ctx, guild) {
        await TV.cleanup(ctx, guild);
        return k('actions.cleanupTempvoice.done');
      }
    }
  ]
};

module.exports = { dashboard };
