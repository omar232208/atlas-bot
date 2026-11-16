'use strict';

const { SlashCommandBuilder, version: djsVersion } = require('discord.js');
const duration = require('../../../core/duration');

const NS = 'core-commands';
const mb = (bytes) => Math.round(bytes / 1048576);

/** /botinfo: uptime, memory, modules, versions and where to host the bot for free. */
module.exports = {
  data: new SlashCommandBuilder().setName('botinfo').setDescription('Show information about the bot'),
  cooldown: 5,
  dm: true,

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { client } = ctx;
    const mem = process.memoryUsage();
    const guilds = client.guilds.cache;
    const members = guilds.reduce((n, g) => n + (g.memberCount || 0), 0);
    const commands = ctx.modules.reduce((n, m) => n + m.commands.length, 0);
    const v = (key, vars) => ctx.t(interaction, `${NS}:botinfo.${key}`, vars);
    const fields = [
      { name: v('uptime'), value: duration.format(process.uptime() * 1000, interaction, { maxParts: 3 }), inline: true },
      { name: v('memory'), value: v('memoryValue', { rss: mb(mem.rss), heap: mb(mem.heapUsed) }), inline: true },
      { name: v('latency'), value: client.ws.ping >= 0 ? ctx.t(interaction, `${NS}:ping.ms`, { value: client.ws.ping }) : ctx.t(interaction, 'common:unknown'), inline: true },
      { name: v('servers'), value: String(guilds.size), inline: true },
      { name: v('members'), value: String(members), inline: true },
      { name: v('modules'), value: v('modulesValue', { modules: ctx.modules.length, commands }), inline: true },
      { name: v('versions'), value: `Node.js ${process.version.slice(1)} · discord.js ${djsVersion}`, inline: false },
      { name: v('hosting'), value: v('hostingValue'), inline: false }
    ];
    await interaction.reply({
      embeds: [ctx.embeds.base({
        title: v('title', { name: client.user.username }),
        description: v('description'),
        fields,
        footer: v('footer'),
        timestamp: true
      }).setThumbnail(client.user.displayAvatarURL())]
    });
  }
};
