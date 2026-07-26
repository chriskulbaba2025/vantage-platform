/**
 * Google OAuth service for GA4 and GSC connections.
 *
 * Handles:
 *  - Generating OAuth authorization URLs
 *  - Exchanging authorization codes for tokens
 *  - Refreshing expired access tokens
 *  - Disconnecting (removing stored tokens)
 *
 * Tokens are stored encrypted via the token store.  No tokens,
 * client secrets, or refresh tokens are ever returned in API responses.
 *
 * Required scopes (read-only):
 *   GA4: https://www.googleapis.com/auth/analytics.readonly
 *   GSC: https://www.googleapis.com/auth/webmasters.readonly
 */

import { SOURCE_STATUS } from "../scoring/evidence-contracts.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export const OAUTH_SCOPES = Object.freeze({
  "google-analytics-4":    "https://www.googleapis.com/auth/analytics.readonly",
  "google-search-console": "https://www.googleapis.com/auth/webmasters.readonly",
});

const PROVIDER_ALIASES = {
  ga4: "google-analytics-4",
  gsc: "google-search-console",
};

function resolveProvider(raw) {
  const key = String(raw || "").toLowerCase();
  return PROVIDER_ALIASES[key] || key;
}

/**
 * Create an OAuth service.
 *
 * @param {object} opts
 * @param {string} opts.clientId       Google OAuth client ID
 * @param {string} opts.clientSecret   Google OAuth client secret
 * @param {string} opts.redirectUri    OAuth redirect URI (e.g. https://worker.example.com/oauth/callback)
 * @param {object} opts.tokenStore     Token store instance from createTokenStore()
 * @param {object} [opts.fetchImpl]    fetch implementation (for testing)
 */
export function createOAuthService(opts = {}) {
  const clientId = opts.clientId || "";
  const clientSecret = opts.clientSecret || "";
  const redirectUri = opts.redirectUri || "";
  const tokenStore = opts.tokenStore;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  const configured = Boolean(clientId && clientSecret && redirectUri);

  /**
   * Build the Google OAuth authorization URL for a provider.
   */
  function getAuthUrl(provider) {
    if (!configured) {
      throw new Error("OAuth is not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI");
    }
    const scope = OAUTH_SCOPES[provider];
    if (!scope) throw new Error(`Unknown OAuth provider: ${provider}`);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope,
      access_type: "offline",
      prompt: "consent",
      state: provider,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Exchange an authorization code for tokens.  Stores encrypted tokens
   * and returns connection metadata (never raw tokens).
   */
  async function exchangeCode(code, provider) {
    if (!configured) throw new Error("OAuth not configured");

    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OAuth token exchange failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || null,
      expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      scope: data.scope || OAUTH_SCOPES[provider] || null,
      token_type: data.token_type || "Bearer",
    };

    await tokenStore.put(provider, tokens);

    return {
      connected: true,
      provider,
      scope: tokens.scope,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    };
  }

  /**
   * Refresh an expired access token using the refresh token.
   */
  async function refreshToken(provider) {
    if (!configured) throw new Error("OAuth not configured");

    const existing = await tokenStore.get(provider);
    if (!existing || !existing.refresh_token) {
      throw new Error(`No refresh token available for ${provider} — re-authorize required`);
    }

    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: existing.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OAuth token refresh failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const tokens = {
      access_token: data.access_token,
      refresh_token: existing.refresh_token, // preserve existing
      expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : null,
      scope: data.scope || existing.scope || null,
      token_type: data.token_type || "Bearer",
    };

    await tokenStore.put(provider, tokens);
    return { connected: true, provider, refreshed: true };
  }

  /**
   * Get a valid access token for a provider, refreshing if necessary.
   * Returns null if not connected.
   */
  async function getAccessToken(provider) {
    const resolved = resolveProvider(provider);
    let tokens = await tokenStore.get(resolved);
    if (!tokens) return null;

    if (tokens.expired && tokens.refresh_token) {
      try {
        await refreshToken(resolved);
        tokens = await tokenStore.get(resolved);
      } catch {
        // Refresh failed — token may be invalid
        return null;
      }
    }

    return tokens.access_token || null;
  }

  /**
   * Disconnect a provider (remove stored tokens).
   */
  async function disconnect(provider) {
    const resolved = resolveProvider(provider);
    await tokenStore.remove(resolved);
    return { connected: false, provider: resolved };
  }

  /**
   * Get connection status for a provider.
   */
  async function getStatus(provider) {
    const resolved = resolveProvider(provider);
    return tokenStore.status(resolved);
  }

  return {
    getAuthUrl,
    exchangeCode,
    refreshToken,
    getAccessToken,
    disconnect,
    getStatus,
    configured,
  };
}
