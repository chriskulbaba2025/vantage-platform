/**
 * MT-02 fail-closed proof — the worker's internal boundary
 * (x-vantage-secret) must NEVER open when the shared webhook secret is
 * missing.  A missing-secret worker denies every internal call (401)
 * instead of silently promoting callers to platform_admin.
 *
 * Uses the REAL createRequestHandler with real memory repositories and a
 * real signed principal for the positive control.
 */

process.env.VANTAGE_DEV_MEMORY_STORE = "true";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createMemoryIdentityRepository } from "./memory-identity-repository.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { signPrincipal } from "./authorization.js";

// Dynamic import AFTER the memory-store gate — server.js's top-level
// startup reads the env at module evaluation time.
const { createRequestHandler } = await import("../server.js");

after(() => process.exit(0));

function buildHandler(webhookSecret) {
  const identityRepo = createMemoryIdentityRepository();
  const lifecycleRepo = createMemoryLifecycleRepository();
  const handler = createRequestHandler({
    config: { artifactDir: ".", webhookSecret, vantageTenantId: "default" },
    localStore: { list: async () => [] },
    store: { list: async () => [] },
    oauthService: { getAuthUrl: () => "", validateState: () => "ga4", exchangeCode: async () => ({}), getStatus: async () => ({}), disconnect: async () => ({}) },
    auditService: { listAudits: async () => [] },
    lifecycleRepo,
    identityRepo,
  });
  return { handler, identityRepo, lifecycleRepo };
}

function request(handler, method, path, { secret, principalToken } = {}) {
  return new Promise((resolvePromise) => {
    const req = {
      method,
      url: new URL(path, "http://worker"),
      headers: {},
      on: () => {},
      [Symbol.asyncIterator]: async function* () { yield Buffer.alloc(0); },
    };
    if (secret) req.headers["x-vantage-secret"] = secret;
    if (principalToken) req.headers["x-prysm-principal"] = principalToken;
    const res = {
      statusCode: 0,
      headers: {},
      body: Buffer.alloc(0),
      writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
      end(payload) {
        this.body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
        resolvePromise({ status: this.statusCode, headers: this.headers, body: this.body });
      },
    };
    handler(req, res);
  });
}

test("MT-02: internal boundary fails closed when webhook secret is missing", async () => {
  const { handler } = buildHandler("");
  const res = await request(handler, "GET", "/api/v1/audits", { secret: "anything-at-all" });
  assert.equal(res.status, 401, "missing-secret internal call must be denied");
});

test("MT-02: principal channel fails closed when webhook secret is missing", async () => {
  const { handler } = buildHandler("");
  const token = signPrincipal({ secret: "", principal: { sub: "s", email: "e@x.co", displayName: "" } });
  const res = await request(handler, "GET", "/api/v1/audits", { principalToken: token });
  assert.equal(res.status, 401, "unverifiable principal must be denied");
});

test("MT-02: governed internal boundary works when the secret IS configured", async () => {
  const { handler } = buildHandler("test-secret");
  const res = await request(handler, "GET", "/api/v1/audits", { secret: "test-secret" });
  assert.equal(res.status, 200, "configured internal boundary must still operate");
});
