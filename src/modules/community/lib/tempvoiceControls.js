'use strict';

const { PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, UserSelectMenuBuilder } = require('discord.js');
const { NS, fail, ok, respond, apiError, clip } = require('./util');
const { limiter } = require('./stats');
const TV = require('./tempvoice');

const ID_RE = /^cmtv:(rename|limit|lock|hide|permit|kick|claim|mrename|mlimit|spermit|skick):(\d+)$/;

/**
 * Parses a temp voice custom id.
 * @param {string} customId
 * @returns {{action: string, channelId: string}|null}
 */
function parseId(customId) {
  const m = ID_RE.exec(customId || '');
  return m ? { action: m[1], channelId: m[2] } : null;
}

const textModal = (interaction, ctx, action, channelId, opts) => new ModalBuilder()
  .setCustomId(`${TV.PREFIX}${action}:${channelId}`)
  .setTitle(ctx.t(interaction, `${NS}:tempvoice.${opts.titleKey}`).slice(0, 45))
  .addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('value').setStyle(TextInputStyle.Short).setRequired(true)
      .setMinLength(1).setMaxLength(opts.max).setLabel(ctx.t(interaction, `${NS}:tempvoice.${opts.labelKey}`).slice(0, 45)).setValue(opts.value)
  ));

const userSelect = (interaction, ctx, action, channelId) => new ActionRowBuilder().addComponents(
  new UserSelectMenuBuilder().setCustomId(`${TV.PREFIX}${action}:${channelId}`).setMinValues(1).setMaxValues(10)
    .setPlaceholder(ctx.t(interaction, `${NS}:tempvoice.selectUsers`).slice(0, 150))
);

/** Toggles a deny overwrite on @everyone (Connect for lock, ViewChannel for hide). */
async function toggle(interaction, ctx, channel, record, field, perm) {
  const next = !record[field];
  await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { [perm]: next ? false : null });
  ctx.store.guild(interaction.guildId).set(TV.tempPath(channel.id), { ...record, [field]: next });
  return ok(interaction, ctx, `tempvoice.${field}.${next ? 'on' : 'off'}`);
}

/**
 * Handles every temp voice button, modal and user select ("cmtv:<action>:<channelId>").
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 */
async function handle(interaction, ctx) {
  const parsed = parseId(interaction.customId);
  if (!parsed || !interaction.guild) return fail(interaction, ctx, 'errors.expired');
  const { action, channelId } = parsed;
  const channel = interaction.guild.channels.cache.get(channelId);
  const record = TV.getTemp(ctx, interaction.guildId, channelId);
  if (!channel || !record) return fail(interaction, ctx, 'tempvoice.gone');

  const isOwner = record.ownerId === interaction.user.id;
  const isStaff = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  if (action === 'claim') {
    if (isOwner) return fail(interaction, ctx, 'tempvoice.alreadyOwner');
    if (interaction.member.voice?.channelId !== channelId) return fail(interaction, ctx, 'tempvoice.joinFirst');
    if (channel.members.has(record.ownerId) && !isStaff) return fail(interaction, ctx, 'tempvoice.ownerPresent');
    ctx.store.guild(interaction.guildId).set(TV.tempPath(channelId), { ...record, ownerId: interaction.user.id });
    await channel.permissionOverwrites.edit(interaction.user.id, { Connect: true, ViewChannel: true }).catch(() => {});
    return ok(interaction, ctx, 'tempvoice.claimed', null, { user: `<@${interaction.user.id}>` }, { ephemeral: false });
  }
  if (!isOwner && !isStaff) return fail(interaction, ctx, 'tempvoice.notOwner', { owner: `<@${record.ownerId}>` });

  try {
    switch (action) {
      case 'rename':
        return interaction.showModal(textModal(interaction, ctx, 'mrename', channelId, { titleKey: 'renameTitle', labelKey: 'renameLabel', max: 100, value: channel.name }));
      case 'limit':
        return interaction.showModal(textModal(interaction, ctx, 'mlimit', channelId, { titleKey: 'limitTitle', labelKey: 'limitLabel', max: 2, value: String(channel.userLimit || 0) }));
      case 'lock':
        return toggle(interaction, ctx, channel, record, 'locked', 'Connect');
      case 'hide':
        return toggle(interaction, ctx, channel, record, 'hidden', 'ViewChannel');
      case 'permit':
      case 'kick':
        return respond(interaction, ctx.embeds.info(ctx.t(interaction, `${NS}:tempvoice.${action}Prompt`)), { ephemeral: true, components: [userSelect(interaction, ctx, `s${action}`, channelId)] });
      case 'mrename': {
        const name = clip(interaction.fields.getTextInputValue('value').trim(), 100);
        if (!name) return fail(interaction, ctx, 'tempvoice.badName');
        const wait = limiter.waitMs(channelId);
        if (wait > 0) return fail(interaction, ctx, 'tempvoice.renameLimit', { time: `<t:${Math.ceil((Date.now() + wait) / 1000)}:R>` });
        limiter.record(channelId);
        await channel.setName(name);
        return ok(interaction, ctx, 'tempvoice.renamed', null, { name });
      }
      case 'mlimit': {
        const value = Number(interaction.fields.getTextInputValue('value').trim());
        if (!Number.isInteger(value) || value < 0 || value > 99) return fail(interaction, ctx, 'tempvoice.badLimit');
        await channel.setUserLimit(value);
        return ok(interaction, ctx, value ? 'tempvoice.limitSet' : 'tempvoice.limitRemoved', null, { limit: value });
      }
      case 'spermit': {
        const ids = [...interaction.values].filter((id) => id !== interaction.user.id);
        for (const id of ids) await channel.permissionOverwrites.edit(id, { Connect: true, ViewChannel: true });
        return interaction.update({ embeds: [ctx.embeds.success(ctx.t(interaction, `${NS}:tempvoice.permitted`, { users: ids.map((id) => `<@${id}>`).join(', ') || '-' }))], components: [] });
      }
      case 'skick': {
        // The owner and staff cannot be kicked out of the channel by its owner.
        const ids = [...interaction.values].filter((id) => id !== record.ownerId && id !== ctx.client.user.id);
        for (const id of ids) {
          await channel.permissionOverwrites.edit(id, { Connect: false });
          const m = channel.members.get(id);
          if (m) await m.voice.disconnect().catch(() => {});
        }
        return interaction.update({ embeds: [ctx.embeds.success(ctx.t(interaction, `${NS}:tempvoice.kicked`, { users: ids.map((id) => `<@${id}>`).join(', ') || '-' }))], components: [] });
      }
      default:
        return fail(interaction, ctx, 'errors.expired');
    }
  } catch (err) {
    return apiError(interaction, ctx, err);
  }
}

module.exports = { parseId, handle };
