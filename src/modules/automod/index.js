'use strict';

const { buildDashboard } = require('./lib/config');

/**
 * Automod: content filters (words, invites, links, mentions, caps, zalgo,
 * emojis, line spam), rate filters (spam, duplicates, attachments), per-filter
 * actions and exemptions, and strike-based escalation. Sanctions go through
 * the moderation module when present, so they get cases and DMs.
 */
module.exports = {
  name: 'automod',
  commands: [require('./commands/automod'), require('./commands/badwords'), require('./commands/links')],
  events: [require('./events/messageCreate'), require('./events/messageUpdate')],
  components: [],
  dashboard: buildDashboard()
};
