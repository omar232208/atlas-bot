'use strict';

const { REST, Routes, ApplicationCommandOptionType, InteractionContextType } = require('discord.js');
const i18n = require('./i18n');
const logger = require('./logger').child('registry');

const isSub = (type) => type === ApplicationCommandOptionType.Subcommand || type === ApplicationCommandOptionType.SubcommandGroup;

/**
 * Locale key prefix for a command: "<module>:commands.<name>".
 * @param {string} ns
 * @param {string} name
 */
const commandKey = (ns, name) => `${ns}:commands.${name}`;

/**
 * Fills description / description_localizations (and choice names) of options
 * from the locale files. Subcommands and groups use "<key>.description" and nest
 * their own options under "<key>.options"; plain options use either a string or
 * an object { description, choices: { <value>: label } }.
 */
function localizeOptions(options, key) {
  for (const opt of options || []) {
    const optKey = `${key}.options.${opt.name}`;
    const rawEn = i18n.raw('en', optKey);
    const descKey = isSub(opt.type) || (rawEn && typeof rawEn === 'object') ? `${optKey}.description` : optKey;
    applyDescription(opt, descKey);
    if (isSub(opt.type)) localizeOptions(opt.options, optKey);
    for (const choice of opt.choices || []) {
      const loc = i18n.localizations(`${optKey}.choices.${choice.value}`);
      if (Object.keys(loc).length) {
        choice.name = loc['en-US'] || choice.name;
        choice.name_localizations = loc;
      }
    }
  }
}

function applyDescription(target, key) {
  const loc = i18n.localizations(key);
  if (loc['en-US']) target.description = loc['en-US'];
  if (Object.keys(loc).length) target.description_localizations = loc;
}

/**
 * Builds the JSON sent to Discord for one command, localized from
 * locales/<lang>/<module>.json. Commands are guild-only unless the command
 * module sets `dm: true`.
 * @param {{data: object, module: string, dm?: boolean}} command
 * @returns {object}
 */
function buildCommandJSON(command) {
  const json = command.data.toJSON();
  const key = commandKey(command.module, json.name);
  applyDescription(json, `${key}.description`);
  localizeOptions(json.options, key);
  if (!command.dm && !json.contexts) json.contexts = [InteractionContextType.Guild];
  return json;
}

/**
 * Builds the JSON of every command of every module.
 * @param {Array<{commands: object[]}>} modules
 */
function buildAll(modules) {
  return modules.flatMap((m) => m.commands.map(buildCommandJSON));
}

/**
 * Registers commands: on GUILD_ID only if set (instant), otherwise globally.
 * Throws the Discord error so bot.js can explain a missing applications.commands scope.
 * @param {string} token
 * @param {string} applicationId
 * @param {object[]} body
 * @param {string} [guildId]
 */
async function register(token, applicationId, body, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId);
  await rest.put(route, { body });
  logger.info(`${body.length} slash commands registered ${guildId ? `on guild ${guildId}` : 'globally'}`);
}

module.exports = { buildCommandJSON, buildAll, register, commandKey };
