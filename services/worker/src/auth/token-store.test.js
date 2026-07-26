import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTokenStore, encrypt, decrypt, deriveKey } from "./token-store.js";

// ---------------------------------------------------------------------------
// Encryption round-trip
// ---------------------------------------------------------------------------

test("encrypt + decrypt round-trip", () => {
  const key = deriveKey("a".repeat(64));
  const plaintext = JSON.stringify({ access_token: "ya29.test", refresh_token: "1//test" });
  const ciphertext = encrypt(plaintext, key);
  assert.ok(ciphertext.length > 0);
  assert.notEqual(ciphertext, plaintext);
  const decrypted = decrypt(ciphertext, key);
  assert.equal(decrypted, plaintext);
});

test("decrypt with wrong key fails", () => {
  const key1 = deriveKey("a".repeat(64));
  const key2 = deriveKey("b".repeat(64));
  const ciphertext = encrypt("test", key1);
  assert.throws(() => decrypt(ciphertext, key2));
});

// ---------------------------------------------------------------------------
// Token store — memory only (no encryption key)
// ---------------------------------------------------------------------------

test("token store put + get in memory without persistence", async () => {
  const store = createTokenStore({});
  await store.put("google-analytics-4", {
    access_token: "ya29.mem",
    refresh_token: "1//mem",
    scope: "analytics.readonly",
  });

  const tokens = await store.get("google-analytics-4");
  assert.equal(tokens.access_token, "ya29.mem");
  assert.equal(tokens.refresh_token, "1//mem");
  assert.equal(tokens.expired, false);
});

test("token store status without key returns connected metadata", async () => {
  const store = createTokenStore({});
  await store.put("google-search-console", {
    access_token: "ya29.gsc",
    scope: "webmasters.readonly",
    expiry_date: Date.now() + 3600_000,
  });
  const status = await store.status("google-search-console");
  assert.equal(status.connected, true);
  assert.equal(status.scope, "webmasters.readonly");
  assert.equal(status.expired, false);
});

test("token store status never returns raw tokens", async () => {
  const store = createTokenStore({});
  await store.put("google-analytics-4", {
    access_token: "ya29.secret",
    refresh_token: "1//secret",
  });
  const status = await store.status("google-analytics-4");
  assert.equal(status.access_token, undefined);
  assert.equal(status.refresh_token, undefined);
});

test("token store remove deletes tokens", async () => {
  const store = createTokenStore({});
  await store.put("google-analytics-4", { access_token: "ya29.x" });
  await store.remove("google-analytics-4");
  const tokens = await store.get("google-analytics-4");
  assert.equal(tokens, null);
  const status = await store.status("google-analytics-4");
  assert.equal(status.connected, false);
});

test("token store expired token detected", async () => {
  const store = createTokenStore({});
  await store.put("google-analytics-4", {
    access_token: "ya29.old",
    expiry_date: Date.now() - 1000, // expired 1s ago
  });
  const tokens = await store.get("google-analytics-4");
  assert.equal(tokens.expired, true);
  assert.equal(tokens.access_token, "ya29.old");
});

test("token store near-expiry within 5min marked expired", async () => {
  const store = createTokenStore({});
  await store.put("google-analytics-4", {
    access_token: "ya29.soon",
    expiry_date: Date.now() + 200_000, // ~3.3 min from now
  });
  const tokens = await store.get("google-analytics-4");
  assert.equal(tokens.expired, true);
});

// ---------------------------------------------------------------------------
// Token store — encrypted persistence
// ---------------------------------------------------------------------------

test("token store persists encrypted tokens to disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-tokens-"));
  try {
    const store = createTokenStore({
      encryptionKey: "a".repeat(64),
      storageDir: dir,
    });
    await store.put("google-analytics-4", {
      access_token: "ya29.disk",
      refresh_token: "1//disk",
      scope: "analytics.readonly",
    });

    // Read from a fresh store (simulating restart)
    const store2 = createTokenStore({
      encryptionKey: "a".repeat(64),
      storageDir: dir,
    });
    const tokens = await store2.get("google-analytics-4");
    assert.equal(tokens.access_token, "ya29.disk");
    assert.equal(tokens.refresh_token, "1//disk");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("token store remove deletes persisted file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vantage-tokens-"));
  try {
    const store = createTokenStore({
      encryptionKey: "a".repeat(64),
      storageDir: dir,
    });
    await store.put("google-analytics-4", { access_token: "ya29.del" });
    await store.remove("google-analytics-4");

    const store2 = createTokenStore({
      encryptionKey: "a".repeat(64),
      storageDir: dir,
    });
    const tokens = await store2.get("google-analytics-4");
    assert.equal(tokens, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("token store rejects put without access_token", async () => {
  const store = createTokenStore({});
  await assert.rejects(
    () => store.put("google-analytics-4", { refresh_token: "x" }),
    /access_token/,
  );
});
