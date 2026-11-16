'use strict';

const { SlashCommandBuilder } = require('discord.js');
const en = require('../en');
const user = require('./userinfo');
const server = require('./serverinfo');
const avatar = require('./avatar');
const role = require('./roleinfo');
const channel = require('./channelinfo');
const members = require('./membercount');
const invites = require('./invites');

/**
 * Group command: /info user|server|avatar|role|channel|members|invites. The
 * lookups share one top-level name, which keeps the bot well inside the
 * per-bot command budget; each lookup stays in its own file.
 */
const lookups = [user, server, avatar, role, channel, members, invites];
const byName = new Map(lookups.map((l) => [l.data.name, l]));

module.exports = {
  data: lookups.reduce(
    (group, l) => group.addSubcommand(l.data),
    new SlashCommandBuilder().setName('info').setDescription(en('utility:commands.info.description'))
  ),

  /** Runs the lookup chosen with the subcommand. */
  async execute(interaction, ctx) {
    return byName.get(interaction.options.getSubcommand()).execute(interaction, ctx);
  }
};
