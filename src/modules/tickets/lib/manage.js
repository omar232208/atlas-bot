'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { NS, getConfig, isStaff, respond, fail, apiFail } = require('./util');
const { buildAttachment } = require('./transcript');
const { getCategories, MEMBER_ALLOW } = require('./open');

const MAX_RATINGS = 200;
const DELETE_DELAY_MS = 5000;

const tr = (ctx, target, key, vars) => ctx.t(target, `${NS}:${key}`, vars);

/**
 * Loads the ticket bound to the interaction channel, or answers "not a ticket".
 * @returns {Promise<{ticket: object, config: object, category: object|null}|null>}
 */
async function load(interaction, ctx) {
  const ticket = ctx.store.guild(interaction.guildId).get(`tickets.list.${interaction.channelId}`);
  if (!ticket) {
    await fail(interaction, ctx, 'errors.notTicket');
    return null;
  }
  const config = getConfig(ctx.store, interaction.guildId);
  const category = getCategories(ctx.store, interaction.guildId).find((c) => c.id === ticket.categoryId) || null;
  return { ticket, config, category };
}

const save = (ctx, interaction, ticket) => ctx.store.guild(interaction.guildId).set(`tickets.list.${interaction.channelId}`, ticket);

/** Sends to the configured ticket log channel, falling back to the shared log system. */
async function sendLog(ctx, guild, embed, files) {
  const { logChannelId } = getConfig(ctx.store, guild.id);
  const channel = logChannelId ? guild.channels.cache.get(logChannelId) : null;
  if (channel?.isTextBased()) {
    try {
      return await channel.send({ embeds: [embed], files: files || [] });
    } catch (err) {
      ctx.logger.warn('tickets: log channel send failed:', err.message);
    }
  }
  return ctx.modlog.send(guild, 'tickets', embed, files ? { files } : undefined);
}

/** Resolves display data the transcript header needs. */
async function enrich(ctx, guild, ticket, category) {
  const tag = async (id) => (id ? (await ctx.client.users.fetch(id).catch(() => null))?.tag || id : null);
  return { ...ticket, ownerTag: await tag(ticket.ownerId), claimedTag: await tag(ticket.claimedBy), categoryName: category?.name || null };
}

/** Row shown on a closed ticket. */
function closedRow(ctx, guild) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tkt:reopen').setStyle(ButtonStyle.Success).setLabel(tr(ctx, guild, 'buttons.reopen')),
    new ButtonBuilder().setCustomId('tkt:transcript').setStyle(ButtonStyle.Secondary).setLabel(tr(ctx, guild, 'buttons.transcript')),
    new ButtonBuilder().setCustomId('tkt:delete').setStyle(ButtonStyle.Danger).setLabel(tr(ctx, guild, 'buttons.delete'))
  );
}

/** Rating buttons sent in DM; the guild id is in the custom id because DMs have no guild. */
function ratingRow(guildId, number) {
  return new ActionRowBuilder().addComponents([1, 2, 3, 4, 5].map((n) =>
    new ButtonBuilder().setCustomId(`tkt:rate:${guildId}:${number}:${n}`).setStyle(ButtonStyle.Secondary).setLabel('★'.repeat(n))));
}

/**
 * Asks for confirmation before closing (button "Close" in the ticket).
 */
async function askClose(interaction, ctx) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  if (data.ticket.status !== 'open') return fail(interaction, ctx, 'errors.alreadyClosed');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tkt:closeyes').setStyle(ButtonStyle.Danger).setLabel(tr(ctx, interaction, 'buttons.confirmClose')),
    new ButtonBuilder().setCustomId('tkt:closeno').setStyle(ButtonStyle.Secondary).setLabel(tr(ctx, interaction, 'buttons.cancel'))
  );
  return interaction.reply({ embeds: [ctx.embeds.warn(tr(ctx, interaction, 'close.confirmTitle'), tr(ctx, interaction, 'close.confirm'))], components: [row], flags: MessageFlags.Ephemeral });
}

/**
 * Closes the ticket: transcript to log + owner, hides the channel from members, rating request.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 * @param {string|null} reason
 */
async function closeTicket(interaction, ctx, reason) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  const { ticket, config, category } = data;
  const { guild, channel, user } = interaction;
  if (ticket.status !== 'open') return fail(interaction, ctx, 'errors.alreadyClosed');
  const staff = isStaff(interaction.member, config, category);
  if (!staff && !(config.ownerCanClose && ticket.ownerId === user.id)) return fail(interaction, ctx, 'errors.notAllowedClose');
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const closedAt = Date.now();
  let makeFile = null;
  try {
    makeFile = await buildAttachment((k) => tr(ctx, guild, k), channel, await enrich(ctx, guild, ticket, category), closedAt);
  } catch (err) {
    ctx.logger.warn('tickets: transcript failed:', err.message);
  }

  Object.assign(ticket, { status: 'closed', closedAt, closedBy: user.id, closeReason: reason || null });
  save(ctx, interaction, ticket);
  ctx.store.guild(guild.id).update('tickets.stats.closed', (n) => (n || 0) + 1, 0);

  try {
    for (const id of [ticket.ownerId, ...ticket.members]) {
      await channel.permissionOverwrites.edit(id, { ViewChannel: false, SendMessages: false }, { reason: tr(ctx, guild, 'close.auditReason') });
    }
  } catch (err) {
    ctx.logger.warn('tickets: could not hide closed ticket:', err.message);
  }

  const reasonText = reason || tr(ctx, guild, 'transcript.none');
  await channel.send({
    embeds: [ctx.embeds.info(tr(ctx, guild, 'close.closedTitle'), tr(ctx, guild, 'close.closed', { user: `<@${user.id}>`, reason: reasonText }))],
    components: [closedRow(ctx, guild)]
  }).catch(() => {});

  await sendLog(ctx, guild, ctx.embeds.base({
    title: tr(ctx, guild, 'log.closedTitle', { number: ticket.number }),
    fields: [
      { name: tr(ctx, guild, 'welcome.owner'), value: `<@${ticket.ownerId}>`, inline: true },
      { name: tr(ctx, guild, 'log.closedBy'), value: `<@${user.id}>`, inline: true },
      { name: tr(ctx, guild, 'log.claimedBy'), value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : tr(ctx, guild, 'transcript.none'), inline: true },
      { name: tr(ctx, guild, 'welcome.reason'), value: reasonText }
    ],
    timestamp: true
  }), makeFile ? [makeFile()] : undefined);

  if (config.dmTranscript || config.ratings) {
    const owner = await ctx.client.users.fetch(ticket.ownerId).catch(() => null);
    if (owner) {
      const components = [];
      if (config.ratings) {
        ctx.store.guild(guild.id).set(`tickets.pendingRatings.${ticket.number}`, ticket.ownerId);
        components.push(ratingRow(guild.id, ticket.number));
      }
      const desc = [tr(ctx, guild, 'dm.closed', { server: guild.name, number: ticket.number, reason: reasonText })];
      if (config.ratings) desc.push(tr(ctx, guild, 'dm.rate'));
      await owner.send({
        embeds: [ctx.embeds.info(tr(ctx, guild, 'dm.title'), desc.join('\n\n'))],
        files: config.dmTranscript && makeFile ? [makeFile()] : [],
        components
      }).catch(() => {});
    }
  }
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'close.doneTitle'), tr(ctx, interaction, 'close.done')));
}

/** Gives the channel back to the owner and added members. Staff only. */
async function reopenTicket(interaction, ctx) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  const { ticket, config, category } = data;
  if (!isStaff(interaction.member, config, category)) return fail(interaction, ctx, 'errors.staffOnly');
  if (ticket.status === 'open') return fail(interaction, ctx, 'errors.alreadyOpen');
  try {
    for (const id of [ticket.ownerId, ...ticket.members]) {
      await interaction.channel.permissionOverwrites.edit(id, Object.fromEntries(MEMBER_ALLOW.map((p) => [permName(p), true])));
    }
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }
  Object.assign(ticket, { status: 'open', closedAt: null, closedBy: null });
  save(ctx, interaction, ticket);
  ctx.store.guild(interaction.guildId).delete(`tickets.pendingRatings.${ticket.number}`);
  await interaction.channel.send({ embeds: [ctx.embeds.info(tr(ctx, interaction, 'reopen.title'), tr(ctx, interaction, 'reopen.done', { user: `<@${interaction.user.id}>` }))] }).catch(() => {});
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'reopen.title'), tr(ctx, interaction, 'reopen.ok')));
}

/** PermissionFlagsBits value -> flag name, as permissionOverwrites.edit expects names. */
function permName(bit) {
  return Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === bit);
}

/** Deletes the ticket channel after a short notice. Staff only. */
async function deleteTicket(interaction, ctx) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  if (!isStaff(interaction.member, data.config, data.category)) return fail(interaction, ctx, 'errors.staffOnly');
  if (!ctx.permissions.botCan(interaction.guild, PermissionFlagsBits.ManageChannels, interaction.channel)) {
    return fail(interaction, ctx, 'errors.botMissing', { perms: 'ManageChannels' });
  }
  await respond(interaction, ctx.embeds.warn(tr(ctx, interaction, 'delete.title'), tr(ctx, interaction, 'delete.soon', { seconds: DELETE_DELAY_MS / 1000 })));
  const { guild, channel, user } = interaction;
  const number = data.ticket.number;
  setTimeout(async () => {
    try {
      await channel.delete(tr(ctx, guild, 'delete.auditReason', { user: user.tag }));
      ctx.store.guild(guild.id).delete(`tickets.list.${channel.id}`);
      await sendLog(ctx, guild, ctx.embeds.info(tr(ctx, guild, 'log.deletedTitle'), tr(ctx, guild, 'log.deleted', { number, user: `<@${user.id}>` })));
    } catch (err) {
      ctx.logger.warn('tickets: delete failed:', err.message);
    }
  }, DELETE_DELAY_MS);
  return null;
}

/** Claims the ticket, or releases it when the claimer runs it again. Staff only. */
async function claimTicket(interaction, ctx) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  const { ticket, config, category } = data;
  const { user } = interaction;
  if (!isStaff(interaction.member, config, category)) return fail(interaction, ctx, 'errors.staffOnly');
  if (ticket.status !== 'open') return fail(interaction, ctx, 'errors.alreadyClosed');
  if (ticket.claimedBy && ticket.claimedBy !== user.id) return fail(interaction, ctx, 'errors.claimedByOther', { user: `<@${ticket.claimedBy}>` });
  const releasing = ticket.claimedBy === user.id;
  ticket.claimedBy = releasing ? null : user.id;
  save(ctx, interaction, ticket);
  const key = releasing ? 'claim.released' : 'claim.claimed';
  await interaction.channel.send({ embeds: [ctx.embeds.info(tr(ctx, interaction, 'claim.title'), tr(ctx, interaction, key, { user: `<@${user.id}>` }))] }).catch(() => {});
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'claim.title'), tr(ctx, interaction, `${key}Self`)));
}

/**
 * Adds or removes a member from the ticket. Owner and staff can add; only staff can remove.
 * @param {'add'|'remove'} action
 * @param {import('discord.js').User} target
 */
async function setMember(interaction, ctx, action, target) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  const { ticket, config, category } = data;
  const staff = isStaff(interaction.member, config, category);
  if (!staff && !(action === 'add' && ticket.ownerId === interaction.user.id)) return fail(interaction, ctx, 'errors.staffOnly');
  if (target.bot && target.id === ctx.client.user.id) return fail(interaction, ctx, 'errors.notSelf');
  if (action === 'remove' && target.id === ticket.ownerId) return fail(interaction, ctx, 'errors.cannotRemoveOwner');
  const inList = ticket.members.includes(target.id);
  if (action === 'add' && (inList || target.id === ticket.ownerId)) return fail(interaction, ctx, 'errors.alreadyIn', { user: `<@${target.id}>` });
  if (action === 'remove' && !inList) return fail(interaction, ctx, 'errors.notIn', { user: `<@${target.id}>` });
  try {
    if (action === 'add') await interaction.channel.permissionOverwrites.edit(target.id, Object.fromEntries(MEMBER_ALLOW.map((p) => [permName(p), true])));
    else await interaction.channel.permissionOverwrites.delete(target.id);
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }
  ticket.members = action === 'add' ? [...ticket.members, target.id] : ticket.members.filter((id) => id !== target.id);
  save(ctx, interaction, ticket);
  const key = action === 'add' ? 'members.added' : 'members.removed';
  await interaction.channel.send({ embeds: [ctx.embeds.info(tr(ctx, interaction, 'members.title'), tr(ctx, interaction, key, { user: `<@${target.id}>`, by: `<@${interaction.user.id}>` }))] }).catch(() => {});
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'members.title'), tr(ctx, interaction, key, { user: `<@${target.id}>`, by: `<@${interaction.user.id}>` })));
}

/** Renames the ticket channel. Staff only. */
async function renameTicket(interaction, ctx, name) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  if (!isStaff(interaction.member, data.config, data.category)) return fail(interaction, ctx, 'errors.staffOnly');
  try {
    await interaction.channel.setName(name.slice(0, 100));
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'rename.title'), tr(ctx, interaction, 'rename.done', { name: interaction.channel.name })));
}

/** Sends the current transcript privately to a staff member. */
async function sendTranscript(interaction, ctx) {
  const data = await load(interaction, ctx);
  if (!data) return null;
  if (!isStaff(interaction.member, data.config, data.category)) return fail(interaction, ctx, 'errors.staffOnly');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const make = await buildAttachment((k) => tr(ctx, interaction, k), interaction.channel, await enrich(ctx, interaction.guild, data.ticket, data.category), data.ticket.closedAt);
    return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'transcript.readyTitle'), tr(ctx, interaction, 'transcript.ready')), { files: [make()] });
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }
}

/**
 * Stores a rating clicked in DM ("tkt:rate:<guild>:<number>:<stars>").
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {object} ctx
 * @param {string[]} parts Custom id split on ":".
 */
async function rate(interaction, ctx, parts) {
  const [, , guildId, number, starsText] = parts;
  const stars = Number(starsText);
  const guild = ctx.client.guilds.cache.get(guildId);
  const target = { guildId };
  if (!guild || !(stars >= 1 && stars <= 5)) return fail(interaction, ctx, 'errors.ratingExpired');
  const gstore = ctx.store.guild(guildId);
  const owner = gstore.get(`tickets.pendingRatings.${number}`);
  if (owner !== interaction.user.id) {
    return interaction.reply({ embeds: [ctx.embeds.error(tr(ctx, target, 'errors.title'), tr(ctx, target, 'errors.ratingExpired'))] }).catch(() => {});
  }
  gstore.delete(`tickets.pendingRatings.${number}`);
  gstore.update('tickets.ratings', (list) => [...(list || []), { number: Number(number), userId: interaction.user.id, stars, at: Date.now() }].slice(-MAX_RATINGS), []);
  await interaction.update({ components: [] }).catch(() => {});
  await interaction.followUp({ embeds: [ctx.embeds.success(tr(ctx, target, 'rating.thanksTitle'), tr(ctx, target, 'rating.thanks', { stars: '★'.repeat(stars) }))] }).catch(() => {});
  await sendLog(ctx, guild, ctx.embeds.info(tr(ctx, guild, 'log.ratedTitle'), tr(ctx, guild, 'log.rated', { number, user: `<@${interaction.user.id}>`, stars: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}` })));
  return null;
}

module.exports = { askClose, closeTicket, reopenTicket, deleteTicket, claimTicket, setMember, renameTicket, sendTranscript, rate, sendLog };
