'use strict';

const { SlashCommandBuilder } = require('discord.js');

const NS = 'core-commands';

/** /ping: gateway heartbeat and real interaction round trip. */
module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Show the bot latency'),
  cooldown: 5,
  dm: true,

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const response = await interaction.reply({ embeds: [ctx.embeds.info(ctx.t(interaction, `${NS}:ping.measuring`))], withResponse: true });
    // Time between the user's click and our message reaching Discord.
    const roundTrip = response.resource.message.createdTimestamp - interaction.createdTimestamp;
    const ws = ctx.client.ws.ping;
    const ms = (value) => ctx.t(interaction, `${NS}:ping.ms`, { value });
    await interaction.editReply({
      embeds: [ctx.embeds.success(ctx.t(interaction, `${NS}:ping.title`), undefined, {
        fields: [
          { name: ctx.t(interaction, `${NS}:ping.roundTrip`), value: ms(roundTrip), inline: true },
          { name: ctx.t(interaction, `${NS}:ping.gateway`), value: ws >= 0 ? ms(ws) : ctx.t(interaction, 'common:unknown'), inline: true }
        ]
      })]
    });
  }
};
