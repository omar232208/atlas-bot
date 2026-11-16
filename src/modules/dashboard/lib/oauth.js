'use strict';

const API = 'https://discord.com/api/v10';
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

/** True when Discord OAuth login is configured. */
const enabled = () => !!process.env.DISCORD_CLIENT_SECRET;

/**
 * Discord authorize URL (identify + guilds scopes).
 * @param {string} clientId
 * @param {string} redirectUri
 * @param {string} state
 */
function authorizeUrl(clientId, redirectUri, state) {
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'identify guilds', redirect_uri: redirectUri, state, prompt: 'none' });
  return `https://discord.com/oauth2/authorize?${q}`;
}

/**
 * Exchanges an authorization code, then reads the user and their guilds.
 * Only Discord is contacted. The access token is used here and dropped:
 * it is never stored nor sent to the browser.
 * @param {{clientId: string, code: string, redirectUri: string, fetchImpl?: Function}} opts
 * @returns {Promise<{user: {id: string, username: string, avatar: string|null}, manageable: string[]}>}
 */
async function exchange(opts) {
  const doFetch = opts.fetchImpl || fetch;
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri
  });
  const tokenRes = await doFetch(`${API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(10000) });
  if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
  const { access_token: accessToken } = await tokenRes.json();
  const auth = { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) };
  const [userRes, guildsRes] = await Promise.all([doFetch(`${API}/users/@me`, auth), doFetch(`${API}/users/@me/guilds`, auth)]);
  if (!userRes.ok || !guildsRes.ok) throw new Error('could not read the Discord profile');
  const user = await userRes.json();
  const guilds = await guildsRes.json();
  const manageable = (Array.isArray(guilds) ? guilds : []).filter((g) => {
    const perms = BigInt(g.permissions || 0);
    return g.owner || (perms & MANAGE_GUILD) === MANAGE_GUILD || (perms & ADMINISTRATOR) === ADMINISTRATOR;
  }).map((g) => String(g.id));
  return { user: { id: String(user.id), username: String(user.global_name || user.username || ''), avatar: user.avatar || null }, manageable };
}

module.exports = { enabled, authorizeUrl, exchange };
