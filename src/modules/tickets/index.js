'use strict';

const { Events, ChannelType } = require('discord.js');
const { NS, DEFAULTS, fail, respond } = require('./lib/util');
const { startOpen, openTicket } = require('./lib/open');
const manage = require('./lib/manage');

const k = (key) => `${NS}:dashboard.${key}`;

/**
 * Routes every "tkt:" component: panel button/select, reason modal, ticket controls, DM ratings.
 * Routing by custom id (instead of collectors) keeps panels working after a restart.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 */
async function handleComponent(interaction, ctx) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  // Ratings arrive from DMs, where there is no guild.
  if (action === 'rate') return manage.rate(interaction, ctx, parts);
  if (!interaction.inGuild()) return null;
  switch (action) {
    case 'open': return startOpen(interaction, ctx, 'none');
    case 'cat': return startOpen(interaction, ctx, interaction.values[0]);
    case 'modal': return openTicket(interaction, ctx, parts[2] || 'none', interaction.fields.getTextInputValue('reason'));
    case 'close': return manage.askClose(interaction, ctx);
    case 'closeyes':
      // Edit the ephemeral confirmation instead of stacking a second reply.
      await interaction.deferUpdate();
      return manage.closeTicket(interaction, ctx, null);
    case 'closeno':
      return interaction.update({ embeds: [ctx.embeds.info(ctx.t(interaction, `${NS}:close.cancelled`))], components: [] });
    case 'claim': return manage.claimTicket(interaction, ctx);
    case 'reopen': return manage.reopenTicket(interaction, ctx);
    case 'delete': return manage.deleteTicket(interaction, ctx);
    case 'transcript': return manage.sendTranscript(interaction, ctx);
    default: return fail(interaction, ctx, 'errors.unexpected');
  }
}

module.exports = {
  name: 'tickets',
  commands: [require('./commands/ticket')],
  components: [{
    prefix: 'tkt:',
    // dm: rating buttons arrive in direct messages, where there is no guild.
    dm: true,
    async execute(interaction, ctx) {
      try {
        await handleComponent(interaction, ctx);
      } catch (err) {
        ctx.logger.error('tickets component failed:', err);
        await respond(interaction, ctx.embeds.error(ctx.t(interaction, `${NS}:errors.title`), ctx.t(interaction, `${NS}:errors.unexpected`)));
      }
    }
  }],
  events: [{
    event: Events.ChannelDelete,
    /** Forget the record of a ticket channel deleted by hand, so it no longer counts as open. */
    execute(ctx, channel) {
      if (!channel.guild) return;
      const gstore = ctx.store.guild(channel.guild.id);
      if (gstore.get(`tickets.list.${channel.id}`)) gstore.delete(`tickets.list.${channel.id}`);
    }
  }],
  dashboard: {
    sections: [
      {
        id: 'general',
        title: k('general.title'),
        description: k('general.description'),
        fields: [
          { path: 'tickets.config.staffRoleIds', type: 'roles', label: k('fields.staffRoleIds'), help: k('help.staffRoleIds'), default: DEFAULTS.staffRoleIds },
          { path: 'tickets.config.logChannelId', type: 'channel', label: k('fields.logChannelId'), help: k('help.logChannelId'), default: DEFAULTS.logChannelId, channelTypes: [ChannelType.GuildText] },
          { path: 'tickets.config.parentId', type: 'channel', label: k('fields.parentId'), help: k('help.parentId'), default: DEFAULTS.parentId, channelTypes: [ChannelType.GuildCategory] },
          { path: 'tickets.config.maxOpen', type: 'number', label: k('fields.maxOpen'), default: DEFAULTS.maxOpen, min: 1, max: 10 },
          { path: 'tickets.config.nameFormat', type: 'string', label: k('fields.nameFormat'), help: k('help.nameFormat'), default: DEFAULTS.nameFormat, maxLength: 60 }
        ]
      },
      {
        id: 'behaviour',
        title: k('behaviour.title'),
        fields: [
          { path: 'tickets.config.askReason', type: 'boolean', label: k('fields.askReason'), default: DEFAULTS.askReason },
          { path: 'tickets.config.ownerCanClose', type: 'boolean', label: k('fields.ownerCanClose'), default: DEFAULTS.ownerCanClose },
          { path: 'tickets.config.dmTranscript', type: 'boolean', label: k('fields.dmTranscript'), default: DEFAULTS.dmTranscript },
          { path: 'tickets.config.ratings', type: 'boolean', label: k('fields.ratings'), help: k('help.ratings'), default: DEFAULTS.ratings },
          { path: 'tickets.config.welcomeMessage', type: 'text', label: k('fields.welcomeMessage'), help: k('help.welcomeMessage'), default: DEFAULTS.welcomeMessage, maxLength: 1500 }
        ]
      }
    ],
    actions: [{
      id: 'resetStats',
      label: k('actions.resetStats'),
      danger: true,
      /** Clears counters and ratings (open tickets are kept). */
      async run(ctx, guild) {
        const gstore = ctx.store.guild(guild.id);
        gstore.delete('tickets.stats');
        gstore.delete('tickets.ratings');
        return k('actions.resetStatsDone');
      }
    }]
  }
};
