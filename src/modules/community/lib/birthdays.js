'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { setting, COLLECTIONS } = require('./config');
const { NS, fill } = require('./util');

const JOB = 'community:birthdays';
const HOUR = 3600000;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Validates a birthday. The year is optional (people may not want to share it);
 * Feb 29 is allowed without a year, or with a leap year.
 * @param {number} day
 * @param {number} month 1-12
 * @param {number|null} [year]
 * @param {number} [nowYear]
 */
function isValidDate(day, month, year, nowYear = new Date().getUTCFullYear()) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) return false;
  if (day > DAYS_IN_MONTH[month - 1]) return false;
  if (year !== null && year !== undefined) {
    if (!Number.isInteger(year) || year < 1900 || year > nowYear) return false;
    if (month === 2 && day === 29 && !isLeap(year)) return false;
  }
  return true;
}

/**
 * Current local date/time of a guild, from its UTC offset in hours (may be fractional).
 * @param {number} offsetHours
 * @param {number} [now]
 * @returns {{year: number, month: number, day: number, hour: number, key: string}}
 */
function localNow(offsetHours, now = Date.now()) {
  const d = new Date(now + Number(offsetHours || 0) * HOUR);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return { year, month, day, hour: d.getUTCHours(), key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
}

/**
 * Whether the entry is celebrated on the given local day. Feb 29 birthdays are
 * celebrated on Feb 28 in non-leap years, like most calendars do.
 * @param {{day: number, month: number}} entry
 * @param {{year: number, month: number, day: number}} local
 */
function isToday(entry, local) {
  if (entry.month === local.month && entry.day === local.day) return true;
  return entry.month === 2 && entry.day === 29 && !isLeap(local.year) && local.month === 2 && local.day === 28;
}

/**
 * Days until the next celebration (0 = today).
 * @param {{day: number, month: number}} entry
 * @param {{year: number, month: number, day: number}} local
 */
function daysUntil(entry, local) {
  const today = Date.UTC(local.year, local.month - 1, local.day);
  for (let y = local.year; y <= local.year + 4; y++) {
    const day = entry.month === 2 && entry.day === 29 && !isLeap(y) ? 28 : entry.day;
    const at = Date.UTC(y, entry.month - 1, day);
    if (at >= today) return Math.round((at - today) / 86400000);
  }
  return 366;
}

/**
 * Age reached on the next celebration, or null when the year is unknown.
 * @param {{day: number, month: number, year?: number|null}} entry
 * @param {{year: number, month: number, day: number}} local
 */
function upcomingAge(entry, local) {
  if (!entry.year) return null;
  const passed = local.month > entry.month || (local.month === entry.month && local.day > entry.day);
  return local.year - entry.year + (passed && !isToday(entry, local) ? 1 : 0);
}

/**
 * Sorts entries by next occurrence.
 * @param {Record<string, object>} users userId -> entry
 * @param {{year: number, month: number, day: number}} local
 * @returns {Array<{userId: string, entry: object, days: number}>}
 */
function upcoming(users, local) {
  return Object.entries(users || {})
    .map(([userId, entry]) => ({ userId, entry, days: daysUntil(entry, local) }))
    .sort((a, b) => a.days - b.days || a.userId.localeCompare(b.userId));
}

/**
 * Daily work for one guild: removes yesterday's birthday role, then announces
 * today's birthdays once, after the configured local hour.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {number} [now]
 */
async function tickGuild(ctx, guild, now = Date.now()) {
  const g = ctx.store.guild(guild.id);
  if (!setting(g, 'community.birthdays.enabled')) return;
  const local = localNow(setting(g, 'community.birthdays.utcOffset'), now);
  const statePath = COLLECTIONS.birthdayState;
  const state = g.get(statePath, {}) || {};
  const roleId = setting(g, 'community.birthdays.roleId');
  const canRoles = ctx.permissions.botCan(guild, PermissionFlagsBits.ManageRoles);

  // Role holders from a previous day lose the role, even if the role setting changed since.
  const holders = (state.holders || []).filter((h) => {
    if (h.date === local.key) return true;
    if (canRoles) guild.members.fetch(h.userId).then((m) => m.roles.remove(h.roleId)).catch(() => {});
    return false;
  });

  if (local.hour < Number(setting(g, 'community.birthdays.hour')) || state.lastRun === local.key) {
    if (holders.length !== (state.holders || []).length) g.set(statePath, { ...state, holders });
    return;
  }

  const users = g.get(COLLECTIONS.birthdays, {});
  const todays = [];
  for (const [userId, entry] of Object.entries(users)) {
    if (!isToday(entry, local)) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) todays.push({ member, entry });
  }

  const role = roleId ? guild.roles.cache.get(roleId) : null;
  if (role && canRoles && role.editable) {
    for (const { member } of todays) {
      const done = await member.roles.add(role).then(() => true).catch(() => false);
      if (done) holders.push({ userId: member.id, roleId: role.id, date: local.key });
    }
  }
  g.set(statePath, { ...state, lastRun: local.key, holders });

  const channel = guild.channels.cache.get(setting(g, 'community.birthdays.channelId'));
  if (!todays.length || !channel?.isTextBased?.() || !ctx.permissions.botCan(guild, PermissionFlagsBits.SendMessages, channel)) return;
  const custom = setting(g, 'community.birthdays.message');
  const lines = todays.map(({ member, entry }) => {
    const age = upcomingAge(entry, local);
    const vars = { user: `<@${member.id}>`, username: member.user.username, server: guild.name, age: age ?? '' };
    if (custom) return fill(custom, vars);
    return ctx.t(guild, `${NS}:birthdays.${age ? 'announceAge' : 'announce'}`, vars);
  });
  const embed = ctx.embeds.base({ title: ctx.t(guild, `${NS}:birthdays.announceTitle`), description: lines.join('\n') });
  await channel.send({ content: todays.map(({ member }) => `<@${member.id}>`).join(' '), embeds: [embed], allowedMentions: { users: todays.map(({ member }) => member.id) } }).catch((err) => {
    ctx.logger.warn(`[community] birthday announce failed in ${guild.id}: ${err.message}`);
  });
}

/**
 * Next full hour, when the next tick should run.
 * @param {number} [now]
 */
const nextHour = (now = Date.now()) => Math.floor(now / HOUR) * HOUR + HOUR + 5000;

/**
 * Registers the hourly job. The job is persistent (scheduler), so a restart keeps
 * the rhythm and an overdue tick runs right away.
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 */
function setup(client, ctx) {
  const ensure = () => {
    if (!ctx.scheduler.list(JOB).length) ctx.scheduler.schedule(JOB, nextHour(), null);
  };
  ctx.scheduler.on(JOB, async () => {
    try {
      for (const guild of client.guilds.cache.values()) {
        await tickGuild(ctx, guild).catch((err) => ctx.logger.warn(`[community] birthdays in ${guild.id}: ${err.message}`));
      }
    } finally {
      ensure();
    }
  });
  ensure();
}

module.exports = { JOB, isLeap, isValidDate, localNow, isToday, daysUntil, upcomingAge, upcoming, tickGuild, nextHour, setup };
