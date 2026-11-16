'use strict';

const { PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { setting, COLLECTIONS } = require('./config');
const { NS, fail, ok, fill, memberVars } = require('./util');

const PREFIX = 'cmtag:';
const MAX_TAGS = 300;
const NAME_RE = /^[\p{Ll}\p{N}_-]{1,32}$/u;

/**
 * Normalises a tag name: lowercase, trimmed, spaces become dashes.
 * @param {string} input
 */
const normalizeName = (input) => String(input || '').trim().toLowerCase().replace(/\s+/g, '-');

/**
 * Valid names are short and safe as a store key (no dots) and inside a custom id.
 * @param {string} name Normalised name.
 */
const isValidName = (name) => NAME_RE.test(name);

const tagPath = (name) => [...COLLECTIONS.tags.split('.'), name];

/**
 * Ranks tag names for autocomplete: prefix matches first, then substring matches.
 * @param {string[]} names
 * @param {string} typed
 * @param {number} [limit]
 */
function searchNames(names, typed, limit = 25) {
  const q = normalizeName(typed);
  if (!q) return [...names].sort().slice(0, limit);
  const starts = names.filter((n) => n.startsWith(q)).sort();
  const contains = names.filter((n) => !n.startsWith(q) && n.includes(q)).sort();
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Fills a tag body. {target} is the member the tag is aimed at (or the caller).
 * @param {string} content
 * @param {object} vars memberVars() of the caller plus target.
 */
const renderTag = (content, vars) => fill(content, vars);

/**
 * Who may create, edit and delete tags: Manage Messages or the configured tag manager role.
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {object} ctx
 */
function canManage(interaction, ctx) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return true;
  const roleId = setting(ctx.store.guild(interaction.guildId), 'community.tags.managerRoleId');
  return !!roleId && !!interaction.member?.roles?.cache?.has(roleId);
}

/**
 * Builds the create/edit modal; the name travels in the custom id.
 * @param {*} lang
 * @param {Function} t
 * @param {'create'|'edit'} mode
 * @param {string} name
 * @param {string} [current]
 */
function modal(lang, t, mode, name, current) {
  const input = new TextInputBuilder().setCustomId('content').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)
    .setLabel(t(lang, `${NS}:tags.modalField`)).setPlaceholder(t(lang, `${NS}:tags.modalPlaceholder`).slice(0, 100));
  if (current) input.setValue(current);
  return new ModalBuilder().setCustomId(`${PREFIX}${mode}:${name}`).setTitle(t(lang, `${NS}:tags.modalTitle.${mode}`, { name }).slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/**
 * Modal submit handler ("cmtag:create:<name>" / "cmtag:edit:<name>").
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 * @param {object} ctx
 */
async function handleModal(interaction, ctx) {
  const m = /^cmtag:(create|edit):(.+)$/u.exec(interaction.customId);
  if (!m || !interaction.isModalSubmit?.() || !isValidName(m[2])) return fail(interaction, ctx, 'errors.expired');
  if (!canManage(interaction, ctx)) return fail(interaction, ctx, 'tags.noPermission');
  const [, mode, name] = m;
  const g = ctx.store.guild(interaction.guildId);
  const existing = g.get(tagPath(name), null);
  const content = interaction.fields.getTextInputValue('content');
  if (mode === 'create') {
    // Someone else may have created the same name while the modal was open.
    if (existing) return fail(interaction, ctx, 'tags.exists', { name });
    if (Object.keys(g.get(COLLECTIONS.tags, {})).length >= MAX_TAGS) return fail(interaction, ctx, 'tags.tooMany', { max: MAX_TAGS });
    g.set(tagPath(name), { name, content, ownerId: interaction.user.id, createdAt: Date.now(), updatedAt: Date.now(), uses: 0 });
    return ok(interaction, ctx, 'tags.created', 'tags.createdDesc', { name });
  }
  if (!existing) return fail(interaction, ctx, 'tags.notFound', { name });
  g.set(tagPath(name), { ...existing, content, updatedAt: Date.now(), editedBy: interaction.user.id });
  return ok(interaction, ctx, 'tags.edited', null, { name });
}

/**
 * Variables available in a tag body.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').User|null} target
 */
function tagVars(interaction, target) {
  const vars = memberVars(interaction.member, interaction.guild, interaction.channel);
  return { ...vars, target: `<@${(target || interaction.user).id}>` };
}

module.exports = { PREFIX, MAX_TAGS, normalizeName, isValidName, tagPath, searchNames, renderTag, canManage, modal, handleModal, tagVars };
