/**
 * Encrypted OAuth token store.
 *
 * Tokens are encrypted at rest using AES-256-GCM.  The encryption key must be
 * supplied via the VANTAGE_ENCRYPTION_KEY environment variable (64 hex chars).
 * When the key is absent, tokens are stored in memory only (never persisted).
 *
 * The store API exposes no raw tokens to callers — get/put operate on
 * plaintext objects internally but the caller must protect returned values.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, chmod } from "node:fs/promises";
import { resolve, join } from "node:path";

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

function deriveKey(raw) {
  // Accept 64-char hex or arbitrary passphrase
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(String(raw)).digest();
}

function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(ciphertext, key) {
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) throw new Error("Invalid ciphertext length");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const _memory = new Map(); // provider -> { token: {...}, savedAt: ISO }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a token store.
 *
 * @param {object}  opts
 * @param {string}  [opts.encryptionKey]  64-char hex string or passphrase
 * @param {string}  [opts.storageDir]     filesystem directory for persistence
 * @returns {object} store
 */
export function createTokenStore(opts = {}) {
  const rawKey = opts.encryptionKey || "";
  const hasKey = rawKey.length >= 32;
  const key = hasKey ? deriveKey(rawKey) : null;
  const storageDir = opts.storageDir || null;

  function filePath(provider) {
    if (!storageDir) return null;
    return join(storageDir, `token-${provider.replace(/[^a-z0-9-]/gi, "_")}.enc`);
  }

  /**
   * Store tokens for a provider.
   *
   * @param {string} provider  "google-analytics-4" or "google-search-console"
   * @param {object} tokens    { access_token, refresh_token?, expiry_date?, scope? }
   */
  async function put(provider, tokens) {
    if (!provider || !tokens?.access_token) {
      throw new Error("Token store put requires provider and access_token");
    }

    const payload = JSON.stringify({
      provider,
      ...tokens,
      savedAt: new Date().toISOString(),
    });

    // Always keep in memory
    _memory.set(provider, { raw: tokens, payload, savedAt: new Date().toISOString() });

    // Persist to disk when encryption is available
    if (hasKey && storageDir) {
      const fp = filePath(provider);
      if (fp) {
        await mkdir(storageDir, { recursive: true });
        const ciphertext = encrypt(payload, key);
        await writeFile(fp, ciphertext, "utf8");
        // Restrict file permissions — owner read/write only (no-op on Windows)
        try { await chmod(fp, 0o600); } catch { /* best-effort */ }
      }
    }
  }

  /**
   * Retrieve tokens for a provider.
   *
   * @returns {object|null}  { access_token, refresh_token, ... } or null
   */
  async function get(provider) {
    // Memory first
    const mem = _memory.get(provider);
    if (mem) {
      // Check if token appears expired
      if (mem.raw.expiry_date && Date.now() > mem.raw.expiry_date - 300_000) {
        // Token expires in less than 5 minutes — caller should refresh
        return { ...mem.raw, expired: true };
      }
      return { ...mem.raw, expired: false };
    }

    // Try disk
    if (hasKey && storageDir) {
      const fp = filePath(provider);
      if (!fp) return null;
      try {
        const ciphertext = await readFile(fp, "utf8");
        const plaintext = decrypt(ciphertext, key);
        const parsed = JSON.parse(plaintext);
        _memory.set(provider, { raw: parsed, payload: plaintext, savedAt: parsed.savedAt });
        if (parsed.expiry_date && Date.now() > parsed.expiry_date - 300_000) {
          return { ...parsed, expired: true };
        }
        return { ...parsed, expired: false };
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Remove tokens for a provider (disconnect).
   */
  async function remove(provider) {
    _memory.delete(provider);
    if (hasKey && storageDir) {
      const fp = filePath(provider);
      if (fp) {
        try { await unlink(fp); } catch { /* already removed */ }
      }
    }
  }

  /**
   * Return connection metadata (NEVER raw tokens).
   */
  async function status(provider) {
    const tokens = await get(provider);
    if (!tokens) return { connected: false, provider, savedAt: null };
    return {
      connected: true,
      provider,
      scope: tokens.scope || null,
      savedAt: tokens.savedAt || null,
      expired: tokens.expired === true,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    };
  }

  return { put, get, remove, status };
}

export { encrypt, decrypt, deriveKey };
