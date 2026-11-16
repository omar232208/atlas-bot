'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { setting } = require('../lib/config');
const { VARIABLES, MAX_LENGTH, unknownVariables, render, memberVars } = require('../lib/template');
const { sendToChannel, sendDm, missingIn } = require('../lib/send');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

const reply = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
const variableList = () => VARIABLES.map((v) => `\`{${v}}\``).join(' ');

/**
 * Builds the /welcome or /goodbye command; both share the same flow, /welcome adds a DM subcommand.
 * @param {'welcome'|'goodbye'} kind
 */
function createGreetingCommand(kind) {
  const data = new SlashCommandBuilder()
    .setName(kind)
    .setDescription(`Configure ${kind} messages`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('set').setDescription('Choose the channel and enable')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(...TEXT_TYPES)))
    .addSubcommand((s) => s.setName('message').setDescription('Change the message template')
      .addStringOption((o) => o.setName('text').setDescription('Template').setRequired(true).setMaxLength(MAX_LENGTH))
      .addBooleanOption((o) => o.setName('embed').setDescription('Send as an embed')));
  if (kind === 'welcome') {
    data.addSubcommand((s) => s.setName('dm').setDescription('Private welcome message')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Send a DM').setRequired(true))
      .addStringOption((o) => o.setName('text').setDescription('Template').setMaxLength(MAX_LENGTH)));
  }
  data
    .addSubcommand((s) => s.setName('test').setDescription('Preview with yourself'))
    .addSubcommand((s) => s.setName('show').setDescription('Show the configuration'))
    .addSubcommand((s) => s.setName('disable').setDescription('Disable'));

  const ns = (key) => `welcome:${kind}.${key}`;

  return {
    data,
    /**
     * @param {import('discord.js').ChatInputCommandInteraction} interaction
     * @param {object} ctx
     */
    async execute(interaction, ctx) {
      const { t, embeds } = ctx;
      const g = ctx.store.guild(interaction.guildId);
      const sub = interaction.options.getSubcommand();

      if (sub === 'set') {
        const channel = interaction.options.getChannel('channel', true);
        const missing = missingIn(channel, setting(g, `${kind}.embed`));
        if (missing.length) return reply(interaction, embeds.error(t(interaction, 'welcome:errors.title'), t(interaction, 'welcome:errors.missingPerms', { channel: `<#${channel.id}>`, perms: missing.map((p) => `\`${p}\``).join(', ') })));
        g.set(`${kind}.channelId`, channel.id);
        g.set(`${kind}.enabled`, true);
        return reply(interaction, embeds.success(t(interaction, ns('setTitle')), t(interaction, ns('setDone'), { channel: `<#${channel.id}>` })));
      }

      if (sub === 'message' || sub === 'dm') {
        const text = interaction.options.getString('text');
        if (sub === 'dm') g.set('welcome.dmEnabled', interaction.options.getBoolean('enabled', true));
        if (text) g.set(sub === 'dm' ? 'welcome.dmMessage' : `${kind}.message`, text);
        const embedOpt = interaction.options.getBoolean('embed');
        if (sub === 'message' && embedOpt !== null) g.set(`${kind}.embed`, embedOpt);
        const unknown = text ? unknownVariables(text) : [];
        const template = (sub === 'dm' ? setting(g, 'welcome.dmMessage') : setting(g, `${kind}.message`)) || t(interaction, `welcome:defaults.${sub === 'dm' ? 'dm' : kind}`);
        const fields = [{ name: t(interaction, 'welcome:common.preview'), value: render(template, memberVars(interaction.member)).slice(0, 1024) }];
        if (unknown.length) fields.push({ name: t(interaction, 'welcome:common.unknownVars'), value: unknown.map((v) => `\`{${v}}\``).join(' ') });
        fields.push({ name: t(interaction, 'welcome:common.variables'), value: variableList() });
        const title = sub === 'dm' ? t(interaction, 'welcome:welcome.dmTitle') : t(interaction, ns('messageTitle'));
        const desc = sub === 'dm' ? t(interaction, setting(g, 'welcome.dmEnabled') ? 'welcome:welcome.dmOn' : 'welcome:welcome.dmOff') : t(interaction, ns('messageDone'));
        return reply(interaction, embeds.success(title, desc, { fields }));
      }

      if (sub === 'test') {
        const result = await sendToChannel(ctx, interaction.member, kind, { force: true }).catch((err) => ({ ok: false, reason: 'error', error: err }));
        if (!result.ok) {
          const key = result.reason === 'noChannel' ? 'welcome:errors.noChannel' : result.reason === 'missing' ? 'welcome:errors.missingPerms' : 'welcome:errors.sendFailed';
          return reply(interaction, embeds.error(t(interaction, 'welcome:errors.title'), t(interaction, key, { command: `/${kind} set`, channel: result.channelId ? `<#${result.channelId}>` : '-', perms: (result.perms || []).map((p) => `\`${p}\``).join(', ') })));
        }
        let description = t(interaction, 'welcome:common.testSent', { channel: `<#${result.channelId}>` });
        if (kind === 'welcome' && setting(g, 'welcome.dmEnabled')) {
          const dm = await sendDm(ctx, interaction.member, { force: true });
          description += `\n${t(interaction, dm ? 'welcome:common.testDmSent' : 'welcome:common.testDmFailed')}`;
        }
        if (!setting(g, `${kind}.enabled`)) description += `\n${t(interaction, 'welcome:common.testDisabledNote')}`;
        return reply(interaction, embeds.success(t(interaction, 'welcome:common.testTitle'), description));
      }

      if (sub === 'show') {
        const yes = t(interaction, 'welcome:common.on');
        const no = t(interaction, 'welcome:common.off');
        const channelId = setting(g, `${kind}.channelId`);
        const fields = [
          { name: t(interaction, 'welcome:common.status'), value: setting(g, `${kind}.enabled`) ? yes : no, inline: true },
          { name: t(interaction, 'welcome:common.channel'), value: channelId ? `<#${channelId}>` : t(interaction, 'welcome:common.none'), inline: true },
          { name: t(interaction, 'welcome:common.embed'), value: setting(g, `${kind}.embed`) ? yes : no, inline: true },
          { name: t(interaction, 'welcome:common.template'), value: `\`\`\`\n${(setting(g, `${kind}.message`) || t(interaction, `welcome:defaults.${kind}`)).replace(/```/g, 'ʼʼʼ').slice(0, 1000)}\n\`\`\`` }
        ];
        if (kind === 'welcome') {
          fields.push({ name: t(interaction, 'welcome:welcome.dmTitle'), value: setting(g, 'welcome.dmEnabled') ? yes : no, inline: true });
        }
        fields.push({ name: t(interaction, 'welcome:common.variables'), value: variableList() });
        return reply(interaction, embeds.info(t(interaction, ns('showTitle')), undefined, { fields }));
      }

      g.set(`${kind}.enabled`, false);
      if (kind === 'welcome') g.set('welcome.dmEnabled', false);
      return reply(interaction, embeds.success(t(interaction, ns('disabledTitle')), t(interaction, ns('disabledDone'))));
    }
  };
}

module.exports = { createGreetingCommand };
