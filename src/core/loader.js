'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logger = require('./logger').child('loader');

const MODULES_DIR = path.join(__dirname, '..', 'modules');

/**
 * Discovers every src/modules/<folder>/index.js and validates its shape.
 * A broken module is logged and skipped so it cannot stop the whole bot.
 * @param {{dir?: string, strict?: boolean}} [opts] strict: throw instead of skipping (used by tests).
 * @returns {Array<{name: string, dir: string, commands: object[], events: object[], components: object[], init?: Function, dashboard?: object, shutdown?: Function}>}
 */
function loadModules(opts = {}) {
  const dir = opts.dir || MODULES_DIR;
  if (!fs.existsSync(dir)) return [];
  const modules = [];
  const commandNames = new Set();
  const prefixes = new Set();
  const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'index.js'))).map((d) => d.name).sort();
  for (const folder of folders) {
    try {
      const mod = require(path.join(dir, folder, 'index.js'));
      const name = mod.name || folder;
      if (name !== folder) throw new Error(`module name "${name}" must match its folder "${folder}" (it is also the locale namespace)`);
      const commands = mod.commands || [];
      const events = mod.events || [];
      const components = mod.components || [];
      for (const cmd of commands) {
        if (!cmd?.data?.toJSON || typeof cmd.execute !== 'function') throw new Error('every command needs "data" (SlashCommandBuilder) and "execute"');
        if (commandNames.has(cmd.data.name)) throw new Error(`duplicate command name "/${cmd.data.name}"`);
        commandNames.add(cmd.data.name);
        // The namespace drives localization lookups and /help grouping.
        cmd.module = name;
      }
      for (const ev of events) {
        if (!ev?.event || typeof ev.execute !== 'function') throw new Error('every event needs "event" and "execute"');
      }
      for (const comp of components) {
        if (typeof comp?.prefix !== 'string' || !comp.prefix || typeof comp.execute !== 'function') throw new Error('every component needs "prefix" and "execute"');
        if (prefixes.has(comp.prefix)) throw new Error(`duplicate component prefix "${comp.prefix}"`);
        prefixes.add(comp.prefix);
      }
      // dashboard (settings schema) and shutdown (exit hook) are optional extras
      // read by the dashboard module and by bot.js on graceful shutdown.
      modules.push({ name, dir: path.join(dir, folder), commands, events, components, init: mod.init, dashboard: mod.dashboard, shutdown: mod.shutdown });
    } catch (err) {
      if (opts.strict) throw new Error(`Module "${folder}": ${err.message}`);
      logger.error(`Module "${folder}" skipped:`, err.message);
    }
  }
  return modules;
}

/**
 * Subscribes module events to the client. Every handler is wrapped so a thrown
 * error is logged instead of crashing the process.
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 * @param {ReturnType<typeof loadModules>} modules
 */
function attachEvents(client, ctx, modules) {
  for (const mod of modules) {
    for (const ev of mod.events) {
      const run = async (...args) => {
        try {
          await ev.execute(ctx, ...args);
        } catch (err) {
          logger.error(`Event ${ev.event} in ${mod.name} failed:`, err);
        }
      };
      client[ev.once ? 'once' : 'on'](ev.event, run);
    }
  }
}

/**
 * Runs each module's init(client, ctx) once, in folder order.
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 * @param {ReturnType<typeof loadModules>} modules
 */
async function initModules(client, ctx, modules) {
  for (const mod of modules) {
    if (typeof mod.init !== 'function') continue;
    try {
      await mod.init(client, ctx);
    } catch (err) {
      logger.error(`init() of ${mod.name} failed:`, err);
    }
  }
}

module.exports = { loadModules, attachEvents, initModules, MODULES_DIR };
