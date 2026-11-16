'use strict';

const { LANGUAGES } = require('../../../core/i18n');

/** Language names as their speakers write them (the same in every locale). */
const LANGUAGE_NAMES = { ar: 'العربية', en: 'English' };

/**
 * Protection modules the setup wizard can switch on, with the store path each
 * module reads for its master switch. Verification is not listed: it needs a
 * role and a channel first, which /verification setup asks for.
 */
const PROTECTIONS = [
  { module: 'antiraid', path: 'antiraid.enabled' },
  { module: 'antinuke', path: 'antinuke.enabled' },
  { module: 'automod', path: 'automod.enabled' }
];

/**
 * Log categories of the logs module (logs.channels.<category>): the wizard sends
 * all of them to one channel, admins can split them later with /logs set.
 */
const LOG_CATEGORIES = ['messages', 'members', 'moderation', 'server', 'voice', 'invites', 'protection', 'tickets'];

/**
 * Protections whose module is actually loaded (a deleted folder disappears from the wizard).
 * @param {Array<{name: string}>} modules
 */
function loadedProtections(modules) {
  const names = new Set((modules || []).map((m) => m.name));
  return PROTECTIONS.filter((p) => names.has(p.module));
}

module.exports = { LANGUAGES, LANGUAGE_NAMES, PROTECTIONS, LOG_CATEGORIES, loadedProtections };
