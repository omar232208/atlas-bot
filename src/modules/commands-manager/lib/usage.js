'use strict';

const { EmbedBuilder } = require('discord.js');
const i18n = require('../../../core/i18n');
const { ACCENT } = require('../../../core/embeds');
const { findCommand, OPT } = require('./runner');

/**
 * Builds the "how to use it" reply shown when a keyword matched but the
 * message could not fill the command's options — a tidy embed with the
 * command description, the exact slash signature, a keyword example and a
 * tap-to-run mention, ProBot style.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {string} name Command name.
 * @returns {{embeds: EmbedBuilder[]}|null} Reply payload, or null when unknown.
 */
function usagePayload(ctx, guild, name) {
  const cmd = findCommand(ctx, name);
  if (!cmd?.data) return null;
  const t = (key, vars) => i18n.t(guild, `commands-manager:usage.${key}`, vars);

  const json = typeof cmd.data.toJSON === 'function' ? cmd.data.toJSON() : cmd.data;
  const top = Array.isArray(json.options) ? json.options : [];
  const groups = top.filter((o) => o.type === OPT.GROUP);
  const subs = top.filter((o) => o.type === OPT.SUB);

  let slashSig;
  let kwSig;
  let subLine = null;

  if (groups.length || subs.length) {
    // First-level identifiers: group names for grouped commands, else sub names.
    const firstLevel = groups.length ? groups.map((g) => g.name) : subs.map((s) => s.name);
    slashSig = `/${name} <${firstLevel.join('|')}>`;
    kwSig = `<${firstLevel.join('|')}>`;
    subLine = firstLevel.join(', ');
  } else {
    const leaf = top.filter((o) => o.type >= OPT.STRING);
    slashSig = `/${name} ${leaf.map(token).join(' ')}`.trim();
    kwSig = leaf.map(token).join(' ');
  }

  const gs = ctx.store.guild(guild.id);
  const keywords = (gs.get(`commands.${name}.keywords`) || []).filter((k) => typeof k === 'string' && k.trim());
  const id = ctx.commandIds?.get(name);
  const mention = id ? `</${name}:${id}>` : `/${name}`;

  const descKey = `commands-manager:dashboard.commands.${name}.description`;
  const desc = i18n.t(guild, descKey);
  const fields = [{ name: t('command'), value: `\`${slashSig}\``, inline: false }];
  // Every configured keyword gets its own example line; with none set, the
  // command name itself is the word the user can reach for.
  const keywordValue = keywords.length
    ? keywords.map((k) => `\`${k} ${kwSig}\``.trimEnd()).join('\n')
    : `\`${name}\``;
  fields.push({ name: t('keyword'), value: keywordValue, inline: false });
  if (subLine) fields.push({ name: t('subs'), value: subLine, inline: false });

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(t('title', { command: `/${name}` }))
    .setDescription(`${desc === descKey ? '' : `${desc}\n\n`}${mention}`)
    .addFields(fields);

  return { embeds: [embed] };
}

/** Placeholder token for one slash option inside a usage signature. */
function token(opt) {
  const inner = (() => {
    switch (opt.type) {
      case OPT.STRING: return opt.choices?.length ? `${opt.name}:${opt.choices.map((c) => c.value).join('/')}` : `${opt.name}:text`;
      case OPT.INTEGER:
      case OPT.NUMBER: return `${opt.name}:number`;
      case OPT.BOOLEAN: return `${opt.name}:yes/no`;
      case OPT.USER: return '@user';
      case OPT.CHANNEL: return '#channel';
      case OPT.ROLE: return '@&role';
      case OPT.MENTIONABLE: return '@user/@&role';
      case OPT.ATTACHMENT: return `${opt.name}:file`;
      default: return opt.name;
    }
  })();
  return opt.required ? `<${inner}>` : `[${inner}]`;
}

module.exports = { usagePayload };
