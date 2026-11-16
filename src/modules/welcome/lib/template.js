'use strict';

/** Variables accepted in welcome, goodbye and DM templates. */
const VARIABLES = ['user', 'username', 'displayname', 'userid', 'server', 'count', 'created'];
const MAX_LENGTH = 1500;

/**
 * Replaces {variable} placeholders. Unknown placeholders are left untouched so a
 * typo stays visible to the admin instead of silently disappearing. A typed
 * "\n" (slash command options cannot contain real line breaks) becomes a newline.
 * @param {string} template
 * @param {Record<string, string|number>} vars
 * @returns {string}
 */
function render(template, vars) {
  return String(template ?? '')
    .replace(/\\n/g, '\n')
    .replace(/\{(\w+)\}/g, (match, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match;
    })
    .slice(0, 4000);
}

/**
 * Builds template variables from a member (or any {user, guild, displayName} shape).
 * @param {import('discord.js').GuildMember} member
 * @param {number} [count] Member count to show (defaults to guild.memberCount).
 */
function memberVars(member, count) {
  const user = member.user;
  return {
    user: `<@${user.id}>`,
    username: user.username,
    displayname: member.displayName || user.globalName || user.username,
    userid: user.id,
    server: member.guild.name,
    count: count ?? member.guild.memberCount,
    created: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`
  };
}

/**
 * Lists placeholders used in a template that are not supported.
 * @param {string} template
 * @returns {string[]}
 */
function unknownVariables(template) {
  const found = [...String(template).matchAll(/\{(\w+)\}/g)].map((m) => m[1].toLowerCase());
  return [...new Set(found.filter((v) => !VARIABLES.includes(v)))];
}

/** True when the rendered text should ping the member (template contains {user}). */
const mentionsUser = (template) => /\{user\}/i.test(String(template));

module.exports = { VARIABLES, MAX_LENGTH, render, memberVars, unknownVariables, mentionsUser };
