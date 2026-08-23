/**
 * MT-02 fail-closed proof — the worker's internal boundary
 * (x-vantage-secret) must NEVER open when the shared webhook secret is
 * missing. A missing-secret worker denies every internal call (401)
 * instead of silently promoting callers to platform_admin.
 *
 * Uses the REAL createRequestHandler with real memory repositories and a
 * real signed principal for the positive control.
 */

process.env.VANTAGE_DEV_MEMORY_STORE = "true";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Server } from "node:http";
import { createMemoryIdentityRepository } from "./memory-identity-repository.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { signPrincipal } from "./authorization.js";

// server.js starts a real HTTP listener as a module side effect.
// Suppress only Server.listen() while importing the module so this test can
// use the real createRequestHandler without opening port 3000 or leaving an
// active server handle behind.
const originalServerListen = Server.prototype.listen;

Server.prototype.listen = function suppressedListen() {
  return this;
};

let createRequestHandler;

try {
  ({ createRequestHandler } = await import("../server.js"));
} finally {
  Server.prototype.listen = originalServerListen;
}

const UAT_AUDIT_ID = "d3b4cc62-9217-4c0b-b169-e24beb46a79c";
const UAT_TENANT_ID = "default";
const UAT_VIEWER_VERSION = "2.2.0";
const UAT_HTML =
  "<!doctype html><html><body>PRYSM Viewer v2.2.0 UAT</body></html>";

function buildHandler(
  webhookSecret,
  auditService = { listAudits: async () => [] },
) {
  const identityRepo = createMemoryIdentityRepository();
  const lifecycleRepo = createMemoryLifecycleRepository();

  const handler = createRequestHandler({
    config: {
      artifactDir: ".",
      webhookSecret,
      vantageTenantId: UAT_TENANT_ID,
    },
    localStore: {
      list: async () => [],
    },
    store: {
      list: async () => [],
    },
    oauthService: {
      getAuthUrl: () => "",
      validateState: () => "ga4",
      exchangeCode: async () => ({}),
      getStatus: async () => ({}),
      disconnect: async () => ({}),
    },
    auditService,
    lifecycleRepo,
    identityRepo,
  });

  return {
    handler,
    identityRepo,
    lifecycleRepo,
  };
}

async function seedUatAudit(lifecycleRepo) {
  await lifecycleRepo.createAudit({
    auditId: UAT_AUDIT_ID,
    tenantId: UAT_TENANT_ID,
    clientId: "uat-route-test-client",
    idempotencyKey: "uat-route-test-seed",
    event: {
      auditId: UAT_AUDIT_ID,
      tenantId: UAT_TENANT_ID,
      nextState: "approved",
    },
  });
}

function request(
  handler,
  method,
  path,
  { secret, principalToken } = {},
) {
  return new Promise((resolvePromise) => {
    const req = {
      method,
      url: new URL(path, "http://worker"),
      headers: {},
      on: () => {},
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.alloc(0);
      },
    };

    if (secret) {
      req.headers["x-vantage-secret"] = secret;
    }

    if (principalToken) {
      req.headers["x-prysm-principal"] = principalToken;
    }

    const res = {
      statusCode: 0,
      headers: {},
      body: Buffer.alloc(0),

      writeHead(code, headers) {
        this.statusCode = code;
        this.headers = headers || {};
      },

      end(payload) {
        this.body = Buffer.isBuffer(payload)
          ? payload
          : Buffer.from(String(payload ?? ""));

        resolvePromise({
          status: this.statusCode,
          headers: this.headers,
          body: this.body,
        });
      },
    };

    handler(req, res);
  });
}

test(
  "MT-02: internal boundary fails closed when webhook secret is missing",
  async () => {
    const { handler } = buildHandler("");

    const res = await request(
      handler,
      "GET",
      "/api/v1/audits",
      {
        secret: "anything-at-all",
      },
    );

    assert.equal(
      res.status,
      401,
      "missing-secret internal call must be denied",
    );
  },
);

test(
  "MT-02: principal channel fails closed when webhook secret is missing",
  async () => {
    const { handler } = buildHandler("");

    const token = signPrincipal({
      secret: "",
      principal: {
        sub: "s",
        email: "e@x.co",
        displayName: "",
      },
    });

    const res = await request(
      handler,
      "GET",
      "/api/v1/audits",
      {
        principalToken: token,
      },
    );

    assert.equal(
      res.status,
      401,
      "unverifiable principal must be denied",
    );
  },
);

test(
  "MT-02: governed internal boundary works when the secret IS configured",
  async () => {
    const { handler } = buildHandler("test-secret");

    const res = await request(
      handler,
      "GET",
      "/api/v1/audits",
      {
        secret: "test-secret",
      },
    );

    assert.equal(
      res.status,
      200,
      "configured internal boundary must still operate",
    );
  },
);

test(
  "PRYSM-V2-UAT-RERENDER-01: UAT route denies unauthenticated access before rendering bytes",
  async () => {
    let renderCalled = false;

    const auditService = {
      listAudits: async () => [],
      getAuditStatus: async () => ({
        state: "approved",
      }),
      getNarrativeV2UatRender: async () => {
        renderCalled = true;

        return {
          bytes: Buffer.from(UAT_HTML, "utf8"),
          viewerVersion: UAT_VIEWER_VERSION,
        };
      },
    };

    const {
      handler,
      lifecycleRepo,
    } = buildHandler(
      "test-secret",
      auditService,
    );

    await seedUatAudit(lifecycleRepo);

    const res = await request(
      handler,
      "GET",
      `/api/v1/audits/${UAT_AUDIT_ID}/uat-render`,
    );

    assert.equal(
      res.status,
      401,
      "unauthenticated UAT render request must be denied",
    );

    assert.equal(
      renderCalled,
      false,
      "UAT renderer must not run before authorization",
    );

    assert.equal(
      res.body.includes(Buffer.from(UAT_HTML)),
      false,
      "UAT HTML bytes must not be returned",
    );
  },
);

test(
  "PRYSM-V2-UAT-RERENDER-01: authorized UAT route streams Viewer v2.2.0 bytes",
  async () => {
    let renderCallCount = 0;

    const expectedBytes = Buffer.from(
      UAT_HTML,
      "utf8",
    );

    const auditService = {
      listAudits: async () => [],

      getAuditStatus: async (auditId) => {
        assert.equal(
          auditId,
          UAT_AUDIT_ID,
        );

        return {
          state: "approved",
        };
      },

      getNarrativeV2UatRender: async (
        auditId,
        tenantId,
      ) => {
        renderCallCount += 1;

        assert.equal(
          auditId,
          UAT_AUDIT_ID,
        );

        assert.equal(
          tenantId,
          UAT_TENANT_ID,
        );

        return {
          bytes: expectedBytes,
          viewerVersion: UAT_VIEWER_VERSION,
        };
      },
    };

    const {
      handler,
      lifecycleRepo,
    } = buildHandler(
      "test-secret",
      auditService,
    );

    await seedUatAudit(lifecycleRepo);

    const res = await request(
      handler,
      "GET",
      `/api/v1/audits/${UAT_AUDIT_ID}/uat-render`,
      {
        secret: "test-secret",
      },
    );

    assert.equal(
      res.status,
      200,
      "authorized UAT render request must succeed",
    );

    assert.equal(
      renderCallCount,
      1,
      "read-only UAT renderer must execute exactly once",
    );

    assert.deepEqual(
      res.body,
      expectedBytes,
      "route must stream the exact rendered HTML bytes",
    );

    assert.equal(
      res.headers["x-prysm-viewer-version"],
      UAT_VIEWER_VERSION,
      "route must identify Viewer v2.2.0",
    );

    assert.equal(
      res.headers["cache-control"],
      "no-store",
      "UAT response must not be cached",
    );
  },
);