'use strict';

/**
 * Central command registry - categorizes all bot commands for dashboard management.
 * Each command gets: category, default enabled, permissions, description.
 * `subcommands` lists the first-level identifiers a user can pick after the
 * command name: a subcommand ("/eco daily") or a subcommand group
 * ("/community stats", "/ticket config"). Commands without either have [].
 */
const COMMANDS = [
  // ========== CORE (الأساسية) ==========
  { name: 'help', category: 'core', label: 'help', description: 'قائمة الأوامر', defaultEnabled: true, subcommands: [] },
  { name: 'ping', category: 'core', label: 'ping', description: 'سرعة الاستجابة', defaultEnabled: true, subcommands: [] },
  { name: 'botinfo', category: 'core', label: 'botinfo', description: 'معلومات البوت', defaultEnabled: true, subcommands: [] },
  { name: 'config', category: 'core', label: 'config', description: 'إعدادات البوت', defaultEnabled: true, subcommands: ['language', 'show', 'reset'] },
  { name: 'setup', category: 'core', label: 'setup', description: 'إعداد موجه أول مرة', defaultEnabled: true, subcommands: [] },
  { name: 'dashboard', category: 'core', label: 'dashboard', description: 'فتح داشبورد الويب', defaultEnabled: true, subcommands: [] },

  // ========== ADMINISTRATION (الإدارة) ==========
  { name: 'ban', category: 'admin', label: 'ban', description: 'حظر عضو', defaultEnabled: true, subcommands: [] },
  { name: 'kick', category: 'admin', label: 'kick', description: 'طرد عضو', defaultEnabled: true, subcommands: [] },
  { name: 'timeout', category: 'admin', label: 'timeout', description: 'تايم آوت عضو', defaultEnabled: true, subcommands: [] },
  { name: 'unban', category: 'admin', label: 'unban', description: 'إلغاء حظر', defaultEnabled: true, subcommands: [] },
  { name: 'warn', category: 'admin', label: 'warn', description: 'تحذير عضو', defaultEnabled: true, subcommands: [] },
  { name: 'case', category: 'admin', label: 'case', description: 'عرض/تعديل/حذف قضية', defaultEnabled: true, subcommands: ['view', 'edit', 'delete'] },
  { name: 'purge', category: 'admin', label: 'purge', description: 'حذف رسائل بالجملة', defaultEnabled: true, subcommands: [] },
  { name: 'slowmode', category: 'admin', label: 'slowmode', description: 'تبطيء الشات', defaultEnabled: true, subcommands: [] },
  { name: 'lock', category: 'admin', label: 'lock', description: 'قفل قناة', defaultEnabled: true, subcommands: [] },
  { name: 'mod', category: 'admin', label: 'mod', description: 'أدوات مودراشن متقدمة', defaultEnabled: true, subcommands: ['clearwarns', 'history', 'massban', 'nick', 'softban', 'unlock', 'untimeout', 'unwarn', 'warnings', 'config', 'warnconfig'] },
  { name: 'role', category: 'admin', label: 'role', description: 'إدارة رتب الأعضاء', defaultEnabled: true, subcommands: ['add', 'remove', 'all', 'info', 'temp'] },
  { name: 'rolemenu', category: 'admin', label: 'rolemenu', description: 'قوائم رتب ذاتية', defaultEnabled: true, subcommands: ['create', 'add', 'remove', 'edit', 'post', 'list', 'delete'] },
  { name: 'autorole', category: 'admin', label: 'autorole', description: 'رتب تلقائية عند الانضمام', defaultEnabled: true, subcommands: ['add', 'remove', 'list'] },
  { name: 'whitelist', category: 'admin', label: 'whitelist', description: 'قائمة بيضاء للحمايات', defaultEnabled: true, subcommands: ['add', 'remove', 'list'] },
  { name: 'say', category: 'admin', label: 'say', description: 'البوت يرسل رسالة', defaultEnabled: true, subcommands: [] },
  { name: 'embed', category: 'admin', label: 'embed', description: 'إرسال إمبد مخصص', defaultEnabled: true, subcommands: [] },
  { name: 'poll', category: 'admin', label: 'poll', description: 'استطلاع رأي', defaultEnabled: true, subcommands: [] },
  { name: 'remind', category: 'admin', label: 'remind', description: 'تذكير لاحقاً', defaultEnabled: true, subcommands: [] },
  { name: 'snipe', category: 'admin', label: 'snipe', description: 'قراءة رسائل محذوفة', defaultEnabled: false, subcommands: ['show', 'enable', 'disable'] },
  { name: 'info', category: 'admin', label: 'info', description: 'معلومات عضو/سيرفر/رتبة', defaultEnabled: true, subcommands: ['user', 'server', 'avatar', 'role', 'channel', 'members', 'invites'] },

  // ========== PROTECTION (الحماية) ==========
  { name: 'antinuke', category: 'protection', label: 'antinuke', description: 'حماية من نيوك', defaultEnabled: true, subcommands: ['status', 'enable', 'disable', 'limit', 'punishment', 'settings', 'release', 'quarantined'] },
  { name: 'panic', category: 'protection', label: 'panic', description: 'وضع الذعر', defaultEnabled: true, subcommands: ['on', 'off'] },
  { name: 'antiraid', category: 'protection', label: 'antiraid', description: 'حماية من رايد', defaultEnabled: true, subcommands: ['status', 'enable', 'disable', 'set'] },
  { name: 'raidmode', category: 'protection', label: 'raidmode', description: 'تفعيل/إيقاف وضع الرايد', defaultEnabled: true, subcommands: ['on', 'off'] },
  { name: 'lockdown', category: 'protection', label: 'lockdown', description: 'إقفال/فتح كل القنوات', defaultEnabled: true, subcommands: ['start', 'end'] },
  { name: 'automod', category: 'protection', label: 'automod', description: 'فلترة أوتوماتيكية', defaultEnabled: true, subcommands: ['status', 'enable', 'disable', 'filter', 'action', 'set', 'exempt', 'settings', 'test', 'escalation', 'strikes'] },
  { name: 'badwords', category: 'protection', label: 'badwords', description: 'كلمات محظورة', defaultEnabled: true, subcommands: ['add', 'remove', 'list', 'clear'] },
  { name: 'links', category: 'protection', label: 'links', description: 'فلترة الروابط', defaultEnabled: true, subcommands: ['allow', 'deny', 'remove', 'mode', 'list'] },
  { name: 'verification', category: 'protection', label: 'verification', description: 'تحقق بالكابتشا', defaultEnabled: true, subcommands: ['setup', 'panel', 'disable', 'status'] },

  // ========== MODERATION LOGS (سجلات المودراشن) ==========
  { name: 'logs', category: 'logs', label: 'logs', description: 'إعداد قنوات السجلات', defaultEnabled: true, subcommands: ['set', 'disable', 'ignore', 'bots', 'status'] },

  // ========== TICKETS (التذاكر) ==========
  { name: 'ticket', category: 'tickets', label: 'ticket', description: 'نظام التذاكر', defaultEnabled: true, subcommands: ['panel', 'close', 'add', 'remove', 'claim', 'rename', 'transcript', 'config', 'category'] },

  // ========== WELCOME/GOODBYE (الترحيب والوداع) ==========
  { name: 'welcome', category: 'welcome', label: 'welcome', description: 'رسائل ترحيب', defaultEnabled: true, subcommands: ['set', 'message', 'dm', 'test', 'show', 'disable'] },
  { name: 'goodbye', category: 'welcome', label: 'goodbye', description: 'رسائل وداع', defaultEnabled: true, subcommands: ['set', 'message', 'test', 'show', 'disable'] },

  // ========== ECONOMY (الاقتصاد) ==========
  { name: 'balance', category: 'economy', label: 'balance', description: 'رصيد المحفظة والبنك', defaultEnabled: true, subcommands: [] },
  { name: 'work', category: 'economy', label: 'work', description: 'عمل لكسب فلوس', defaultEnabled: true, subcommands: [] },
  { name: 'pay', category: 'economy', label: 'pay', description: 'تحويل فلوس', defaultEnabled: true, subcommands: [] },
  { name: 'bank', category: 'economy', label: 'bank', description: 'إيداع/سحب من البنك', defaultEnabled: true, subcommands: ['deposit', 'withdraw'] },
  { name: 'shop', category: 'economy', label: 'shop', description: 'متجر الرتب/الأدوار', defaultEnabled: true, subcommands: ['list', 'buy', 'add', 'remove'] },
  { name: 'gamble', category: 'economy', label: 'gamble', description: 'ألعاب قمار', defaultEnabled: true, subcommands: ['coinflip', 'slots', 'blackjack'] },
  { name: 'eco', category: 'economy', label: 'eco', description: 'إعدادات الاقتصاد', defaultEnabled: true, subcommands: ['daily', 'weekly', 'rob', 'inventory', 'richest', 'config'] },

  // ========== LEVELS (المستويات) ==========
  { name: 'rank', category: 'levels', label: 'rank', description: 'رتبتك ومستواك', defaultEnabled: true, subcommands: [] },
  { name: 'leaderboard', category: 'levels', label: 'leaderboard', description: 'أكثر الأعضاء نشاطاً', defaultEnabled: true, subcommands: [] },
  { name: 'levels', category: 'levels', label: 'levels', description: 'إعدادات المستويات', defaultEnabled: true, subcommands: ['enable', 'disable', 'config', 'reset', 'reward-add', 'reward-remove', 'reward-list'] },

  // ========== GIVEAWAYS (الهدايا) ==========
  { name: 'giveaway', category: 'giveaways', label: 'giveaway', description: 'إدارة الهدايا', defaultEnabled: true, subcommands: ['start', 'end', 'reroll', 'cancel', 'list'] },

  // ========== FUN/GAMES (الترفيه والألعاب) ==========
  { name: '8ball', category: 'fun', label: '8ball', description: 'كرة الثماني السحرية', defaultEnabled: true, subcommands: [] },
  { name: 'dice', category: 'fun', label: 'dice', description: 'رمي نرد', defaultEnabled: true, subcommands: [] },
  { name: 'game', category: 'fun', label: 'game', description: 'ألعاب: تيك تاك تو، كونكت 4، ح ط م، شنق، ترافيا', defaultEnabled: true, subcommands: ['tictactoe', 'connect4', 'rps', 'hangman', 'trivia'] },
  { name: 'fun', category: 'fun', label: 'fun', description: 'أدوات ترفيهية', defaultEnabled: true, subcommands: ['choose', 'ship', 'reverse', 'emojify'] },

  // ========== COMMUNITY (المجتمع) ==========
  { name: 'afk', category: 'community', label: 'afk', description: 'حالة غياب', defaultEnabled: true, subcommands: [] },
  { name: 'birthday', category: 'community', label: 'birthday', description: 'أعياد ميلاد', defaultEnabled: true, subcommands: ['set', 'remove', 'view', 'list', 'config'] },
  { name: 'starboard', category: 'community', label: 'starboard', description: 'ستاربورد', defaultEnabled: true, subcommands: ['set', 'ignore', 'disable', 'status'] },
  { name: 'suggest', category: 'community', label: 'suggest', description: 'اقتراح فكرة', defaultEnabled: true, subcommands: [] },
  { name: 'suggestion', category: 'community', label: 'suggestion', description: 'إدارة الاقتراحات', defaultEnabled: true, subcommands: ['accept', 'deny', 'consider', 'implement', 'delete', 'list', 'config'] },
  { name: 'tag', category: 'community', label: 'tag', description: 'ردود محفوظة', defaultEnabled: true, subcommands: ['use', 'create', 'edit', 'delete', 'info', 'list'] },
  { name: 'tempvoice', category: 'community', label: 'tempvoice', description: 'قنوات صوتية مؤقتة', defaultEnabled: true, subcommands: ['setup', 'remove', 'list', 'panel'] },
  { name: 'community', category: 'community', label: 'community', description: 'إحصائيات، رسائل لاصقة، ردود تلقائية', defaultEnabled: true, subcommands: ['stats', 'sticky', 'autoresponder'] },

  // ========== MUSIC (الموسيقى) ==========
  { name: 'play', category: 'music', label: 'play', description: 'تشغيل مقطع', defaultEnabled: true, subcommands: [] },
  { name: 'pause', category: 'music', label: 'pause', description: 'إيقاف مؤقت', defaultEnabled: true, subcommands: [] },
  { name: 'resume', category: 'music', label: 'resume', description: 'استكمال التشغيل', defaultEnabled: true, subcommands: [] },
  { name: 'skip', category: 'music', label: 'skip', description: 'تخطي المقطع الحالي', defaultEnabled: true, subcommands: [] },
  { name: 'stop', category: 'music', label: 'stop', description: 'إيقاف التشغيل', defaultEnabled: true, subcommands: [] },
  { name: 'nowplaying', category: 'music', label: 'nowplaying', description: 'المقطع الحالي', defaultEnabled: true, subcommands: [] },
  { name: 'queue', category: 'music', label: 'queue', description: 'قائمة الانتظار', defaultEnabled: true, subcommands: ['view', 'remove', 'move', 'clear', 'shuffle'] },
  { name: 'loop', category: 'music', label: 'loop', description: 'تكرار المقطع/القائمة', defaultEnabled: true, subcommands: [] },
  { name: 'seek', category: 'music', label: 'seek', description: 'الانتقال لوقت معين', defaultEnabled: true, subcommands: [] },
  { name: 'volume', category: 'music', label: 'volume', description: 'مستوى الصوت', defaultEnabled: true, subcommands: [] },
  { name: 'radio', category: 'music', label: 'radio', description: 'محطات الراديو', defaultEnabled: true, subcommands: [] },
  { name: 'music', category: 'music', label: 'music', description: 'التحكم بالموسيقى والإعدادات', defaultEnabled: true, subcommands: ['join', 'leave', 'show', 'config', 'reset'] },

  // ========== BACKUP (النسخ الاحتياطي) ==========
  { name: 'backup', category: 'backup', label: 'backup', description: 'نسخ احتياطية للسيرفر', defaultEnabled: true, subcommands: ['create', 'list', 'info', 'load', 'delete', 'auto'] },
];

const CATEGORIES = [
  { id: 'core', name: 'الأساسية', icon: 'sliders', description: 'أوامر البوت الأساسية' },
  { id: 'admin', name: 'الإدارة', icon: 'flag', description: 'أوامر المشرفين: حظر، طرد، تايم آوت، حذف رسائل...' },
  { id: 'protection', name: 'الحماية', icon: 'shield', description: 'أنتي نيوك، أنتي رايد، أوتو مود، تحقق...' },
  { id: 'logs', name: 'السجلات', icon: 'list', description: 'قنوات سجلات المودراشن' },
  { id: 'tickets', name: 'التذاكر', icon: 'ticket', description: 'نظام تذاكر الدعم' },
  { id: 'welcome', name: 'الترحيب والوداع', icon: 'userPlus', description: 'رسائل ترحيب، وداع، أوتو رول' },
  { id: 'economy', name: 'الاقتصاد', icon: 'coins', description: 'فلوس، بنك، متجر، قمار، يومي/أسبوعي' },
  { id: 'levels', name: 'المستويات', icon: 'chart', description: 'خبرة، رتب مكافآت، ليدربورد' },
  { id: 'giveaways', name: 'الهدايا', icon: 'gift', description: 'إنشاء وإدارة الهدايا' },
  { id: 'fun', name: 'الترفيه', icon: 'dice', description: 'ألعاب، ترافيا، أدوات مسلية' },
  { id: 'community', name: 'المجتمع', icon: 'users', description: 'اقتراحات، ستاربورد، تاجز، AFK، صوتيات مؤقتة' },
  { id: 'music', name: 'الموسيقى', icon: 'music', description: 'تشغيل موسيقى وراديو' },
  { id: 'backup', name: 'النسخ الاحتياطي', icon: 'archive', description: 'حفظ واستعادة السيرفر' },
];

function getCommand(name) {
  return COMMANDS.find(c => c.name === name);
}

function getCommandsByCategory(category) {
  return COMMANDS.filter(c => c.category === category);
}

function getAllCommands() {
  return COMMANDS;
}

function getCategories() {
  return CATEGORIES;
}

function getCategory(id) {
  return CATEGORIES.find(c => c.id === id);
}

/** Store path of a command's master switch: commands.<name>.enabled */
function getDefaultStorePath(commandName) {
  return `commands.${commandName}.enabled`;
}

/** Store path of a command's allowed-roles list: commands.<name>.allowedRoles */
function getRolesStorePath(commandName) {
  return `commands.${commandName}.allowedRoles`;
}

/** Store path of a command's keyword triggers: commands.<name>.keywords */
function getKeywordsStorePath(commandName) {
  return `commands.${commandName}.keywords`;
}

/** Store path of a command's allowed-channels list: commands.<name>.allowedChannels */
function getChannelsStorePath(commandName) {
  return `commands.${commandName}.allowedChannels`;
}

/**
 * Store path of one subcommand's switch: commands.<name>.<sub>.enabled.
 * `sub` is the first-level identifier (subcommand or subcommand group name).
 */
function getSubEnabledStorePath(commandName, sub) {
  return `commands.${commandName}.${sub}.enabled`;
}

/**
 * Store path of the single required role of a command (admin-commands module):
 * adminCommands.<name>.role. Empty/null means no extra role requirement.
 */
function getRequiredRolePath(commandName) {
  return `adminCommands.${commandName}.role`;
}

module.exports = {
  COMMANDS,
  CATEGORIES,
  getCommand,
  getCommandsByCategory,
  getAllCommands,
  getCategories,
  getCategory,
  getDefaultStorePath,
  getRolesStorePath,
  getKeywordsStorePath,
  getChannelsStorePath,
  getSubEnabledStorePath,
  getRequiredRolePath,
};
