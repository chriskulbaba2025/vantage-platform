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

const NARRATIVE_REVIEW_RESULT = Object.freeze({
  status: "HUMAN_REVIEW_REQUIRED",
  passNumber: 2,
  defects: Object.freeze([
    Object.freeze({
      code: "ROOT_CAUSE_INCOMPLETE",
      message: "Root-cause synthesis requires revision.",
    }),
  ]),
});

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
  {
    secret,
    principalToken,
    body,
  } = {},
) {
  return new Promise((resolvePromise) => {
    const requestBody =
      body === undefined
        ? Buffer.alloc(0)
        : Buffer.from(JSON.stringify(body), "utf8");

    const req = {
      method,
      url: new URL(path, "http://worker"),
      headers: {},
      on: () => {},
      [Symbol.asyncIterator]: async function* () {
        yield requestBody;
      },
    };

    if (secret) {
      req.headers["x-vantage-secret"] = secret;
    }

    if (principalToken) {
      req.headers["x-prysm-principal"] = principalToken;
    }

    if (body !== undefined) {
      req.headers["content-type"] = "application/json";
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

function readJsonBody(res) {
  return JSON.parse(res.body.toString("utf8"));
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

test(
  "NARRATIVE-V2-REVIEW-HTTP-01: narrative review denies unauthenticated access before reading governed review",
  async () => {
    let reviewCallCount = 0;

    const auditService = {
      listAudits: async () => [],
      getNarrativeV2HumanReview: async () => {
        reviewCallCount += 1;
        return NARRATIVE_REVIEW_RESULT;
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
      `/api/v1/audits/${UAT_AUDIT_ID}/narrative-review`,
    );

    assert.equal(
      res.status,
      401,
      "unauthenticated narrative-review request must be denied",
    );

    assert.equal(
      reviewCallCount,
      0,
      "governed review must not be read before authorization",
    );
  },
);

test(
  "NARRATIVE-V2-REVIEW-HTTP-02: authorized narrative review returns the governed Judge result without mutation",
  async () => {
    let reviewCallCount = 0;

    const auditService = {
      listAudits: async () => [],
      getNarrativeV2HumanReview: async (
        auditId,
        tenantId,
      ) => {
        reviewCallCount += 1;

        assert.equal(
          auditId,
          UAT_AUDIT_ID,
        );

        assert.equal(
          tenantId,
          UAT_TENANT_ID,
        );

        return NARRATIVE_REVIEW_RESULT;
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
      `/api/v1/audits/${UAT_AUDIT_ID}/narrative-review`,
      {
        secret: "test-secret",
      },
    );

    assert.equal(
      res.status,
      200,
      "authorized narrative-review request must succeed",
    );

    assert.equal(
      reviewCallCount,
      1,
      "governed review must be read exactly once",
    );

    assert.deepEqual(
      readJsonBody(res),
      NARRATIVE_REVIEW_RESULT,
      "route must return the exact governed Judge review",
    );
  },
);

test(
  "NARRATIVE-V2-FINAL-HTTP-01: final-pass route denies unauthenticated access before continuation",
  async () => {
    let continuationCallCount = 0;

    const auditService = {
      listAudits: async () => [],
      continueNarrativeV2FinalPass: async () => {
        continuationCallCount += 1;

        return {
          finalState: "draft_rendered",
          error: null,
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
      "POST",
      `/api/v1/audits/${UAT_AUDIT_ID}/narrative-final-pass`,
      {
        body: {
          authorizationId: "human-auth-1",
        },
      },
    );

    assert.equal(
      res.status,
      401,
      "unauthenticated final-pass request must be denied",
    );

    assert.equal(
      continuationCallCount,
      0,
      "final-pass continuation must not execute before authorization",
    );
  },
);

test(
  "NARRATIVE-V2-FINAL-HTTP-02: final-pass route requires explicit authorization id",
  async () => {
    let continuationCallCount = 0;

    const auditService = {
      listAudits: async () => [],
      continueNarrativeV2FinalPass: async () => {
        continuationCallCount += 1;

        return {
          finalState: "draft_rendered",
          error: null,
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
      "POST",
      `/api/v1/audits/${UAT_AUDIT_ID}/narrative-final-pass`,
      {
        secret: "test-secret",
        body: {},
      },
    );

    assert.equal(
      res.status,
      422,
      "final-pass request without authorization id must fail closed",
    );

    assert.equal(
      continuationCallCount,
      0,
      "continuation must not execute without explicit authorization",
    );

    assert.equal(
      readJsonBody(res).code,
      "NARRATIVE_V2_FINAL_PASS_AUTHORIZATION_REQUIRED",
    );
  },
);

test(
  "NARRATIVE-V2-FINAL-HTTP-03: authorized final-pass request forwards one explicit authorization",
  async () => {
    let continuationCallCount = 0;

    const authorizationId =
      "narrative-final-pass:test-human-authorization";

    const auditService = {
      listAudits: async () => [],
      continueNarrativeV2FinalPass: async (
        auditId,
        tenantId,
        receivedAuthorizationId,
      ) => {
        continuationCallCount += 1;

        assert.equal(
          auditId,
          UAT_AUDIT_ID,
        );

        assert.equal(
          tenantId,
          UAT_TENANT_ID,
        );

        assert.equal(
          receivedAuthorizationId,
          authorizationId,
        );

        return {
          finalState: "draft_rendered",
          error: null,
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
      "POST",
      `/api/v1/audits/${UAT_AUDIT_ID}/narrative-final-pass`,
      {
        secret: "test-secret",
        body: {
          authorizationId,
        },
      },
    );

    assert.equal(
      res.status,
      200,
      "authorized final-pass request must succeed",
    );

    assert.equal(
      continuationCallCount,
      1,
      "final-pass continuation must execute exactly once",
    );

    assert.deepEqual(
      readJsonBody(res),
      {
        auditId: UAT_AUDIT_ID,
        authorized: true,
        finalState: "draft_rendered",
        error: null,
      },
    );
  },
);
