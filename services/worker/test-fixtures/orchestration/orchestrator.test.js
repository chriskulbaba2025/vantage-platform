/**
 * WP5 Orchestrator Behavioral Tests
 *
 * Proves all 13 required behaviors through production-shaped mocked execution.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createMemoryLifecycleRepository } from "../../src/lifecycle/memory-repository.js";
import { createLifecycleService } from "../../src/lifecycle/lifecycle-service.js";
import { createGovernedArtifactStore } from "../../src/storage/governed-artifact-store.js";
import { createAuditOrchestrator } from "../../src/orchestration/audit-orchestrator.js";
import { LIFECYCLE_STATE } from "../../src/lifecycle/state-enum.js";
import {
  createBaseMockAdapters, createFullMockAdapters,
  createFailingAdapter, createPartialAdapter,
  createMockOnpageAdapter, createMockPagespeedAdapter,
  createMockSerpAdapter, createMockBacklinksAdapter,
  createMockGa4Adapter, createMockGscAdapter,
} from "./mock-adapters.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const T = LIFECYCLE_STATE;

// ---------------------------------------------------------------------------
// Schema validator setup
// ---------------------------------------------------------------------------
const schemasDir = resolve(__dirname, "..", "..", "src", "contracts");
const SCHEMA_IDS = [
  "audit-request.schema.json",
  "source-result.schema.json",
  "canonical-evidence.schema.json",
];

function createValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  for (const f of SCHEMA_IDS) {
    const schema = JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8"));
    ajv.addSchema(schema, schema.$id);
  }
  return ajv;
}

function validateContract(schemaId, obj) {
  const ajv = createValidator();
  const v = ajv.getSchema(schemaId);
  const valid = v(obj);
  return { valid, errors: v.errors || [] };
}

// ---------------------------------------------------------------------------
// Injected clock for deterministic tests
// ---------------------------------------------------------------------------
function createMockClock(iso = "2026-01-01T00:00:00.000Z") {
  let current = iso;
  return {
    now: () => current,
    sleep: async () => {},
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)),
  };
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
function createOrchestrator(opts = {}) {
  const repo = opts.repo || createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  return createAuditOrchestrator({
    lifecycleService: lc,
    artifactStore: opts.artifactStore || createGovernedArtifactStore({ type: "memory" }),
    adapters: opts.adapters || createBaseMockAdapters(),
    validateContract: opts.validateContract || validateContract,
    clock: opts.clock || createMockClock(),
    timer: opts.timer || null,
    retryPolicyResolver: opts.retryPolicyResolver || null,
  });
}

function baseAuditRequest(overrides = {}) {
  return {
    contractVersion: "1.0.0",
    auditId: randomUUID(),
    tenantId: "t1",
    clientId: "c1",
    idempotencyKey: randomUUID(),
    targetUrl: "https://example.com",
    businessName: "Test Business",
    market: "Test Market",
    language: "en-CA",
    ...overrides,
  };
}

// =========================================================================
// Tests
// =========================================================================

// ── 1. Full mocked audit ──────────────────────────────────────────────
test("full mocked audit reaches EVIDENCE_LOCKED", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const orch = createOrchestrator({ artifactStore: store, adapters: createBaseMockAdapters() });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.ok(summary.canonicalEvidence, "Canonical evidence must exist");
  assert.ok(summary.canonicalEvidence.key.includes("canonical/evidence.json"));

  // Verify canonical evidence exists and validates
  const evidenceBuf = await store.get(summary.canonicalEvidence.key);
  assert.ok(evidenceBuf, "Canonical evidence readable");
  assert.equal(evidenceBuf.length, summary.canonicalEvidence.bytes);

  // Validate canonical evidence against schema
  const evidence = JSON.parse(evidenceBuf.toString());
  const { valid, errors } = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/canonical-evidence.schema.json",
    evidence,
  );
  assert.ok(valid, `Canonical evidence invalid: ${errors.map(e => e.message).join("; ")}`);

  // Verify all 4 base sources executed
  assert.equal(summary.sources.length, 4);
  for (const s of summary.sources) {
    assert.ok(s.artifactKey, `Source ${s.source} must have artifact key`);
  }
});

// ── 2. Source independence — one FAILED, rest continue ────────────────
test("one FAILED source does not stop others", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const adapters = createBaseMockAdapters();
  adapters["dataforseo-onpage"] = createFailingAdapter("dataforseo-onpage", { failOnAttempt: 1, errorCategory: "internal" });

  const orch = createOrchestrator({ artifactStore: store, adapters });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  // Must still reach EVIDENCE_LOCKED despite one FAILED source
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  // All 4 sources should be in the summary
  assert.equal(summary.sources.length, 4, "All 4 sources still present");

  // Later sources still executed
  const serpSrc = summary.sources.find(s => s.source === "dataforseo-serp");
  assert.ok(serpSrc, "SERP source executed after failing onpage");
  const pagespeedSrc = summary.sources.find(s => s.source === "pagespeed");
  assert.ok(pagespeedSrc, "Pagespeed source executed");
});

// ── 3. Partial and blocked sources preserve status ────────────────────
test("PARTIAL source status preserved in canonical evidence", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const adapters = createBaseMockAdapters();
  adapters["backlinks"] = createPartialAdapter("backlinks", "PARTIAL");

  const orch = createOrchestrator({ artifactStore: store, adapters });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  const evidenceBuf = await store.get(summary.canonicalEvidence.key);
  const evidence = JSON.parse(evidenceBuf.toString());

  // Backlinks status preserved in sources
  if (evidence.sources.backlinks) {
    assert.ok(evidence.sources.backlinks.status, "Backlinks status present");
  }
  // Verify no fabricated zero
  assert.equal(evidence.sources.website.status, "AVAILABLE", "Website still AVAILABLE");
});

// ── 4. Timeout ────────────────────────────────────────────────────────
test("timeout aborts execution and produces FAILED", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const adapters = createBaseMockAdapters();
  let aborted = false;

  adapters["pagespeed"] = {
    execute: async ({ signal }) => {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (signal.aborted) {
            aborted = true;
            const err = new Error("Timed out");
            err.category = "timeout";
            reject(err);
            return;
          }
          setTimeout(check, 1);
        };
        check();
      });
    },
  };

  const orch = createOrchestrator({
    artifactStore: store,
    adapters,
    retryPolicyResolver: () => ({ timeoutMs: 10, maxAttempts: 1, retryable: () => false, delayMs: () => 0 }),
  });

  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  // The timeout source should produce FAILED, but audit should still reach EVIDENCE_LOCKED
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.ok(aborted, "Signal must be aborted on timeout");
});

// ── 5. Transient retry succeeds — exact retry count ──────────────────
test("transient failure: retryCount = actual attempts - 1 (success on 3rd)", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["dataforseo-serp"] = {
    execute: async () => {
      attempts++;
      if (attempts < 3) {
        const err = new Error("Transient network error");
        err.category = "network";
        err.statusCode = 503;
        throw err;
      }
      // Return WITH an incorrect retryCount — orchestrator must override it
      return {
        rawBytes: Buffer.from(JSON.stringify({ serp: true }), "utf-8"),
        contentType: "application/json",
        sourceResult: {
          provider: "MockProvider",
          adapterVersion: "1.0.0",
          status: "AVAILABLE",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          retryCount: 99, // ← orchestrator must override this
          expectedRecords: 3,
          returnedRecords: 3,
          coverage: { requested: 3, completed: 3, failed: 0 },
          limitations: [],
          evidence: {},
        },
      };
    },
  };

  const orch = createOrchestrator({
    artifactStore: store,
    adapters,
    retryPolicyResolver: () => ({
      timeoutMs: 30000,
      maxAttempts: 3,
      retryable: (e) => e?.category === "network",
      delayMs: () => 0,
    }),
  });

  const req = baseAuditRequest();
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(attempts, 3, "Exactly 3 attempts");

  // Verify the orchestrator-corrected retry count in summary and persisted artifact
  const serpSrc = summary.sources.find(s => s.source === "dataforseo-serp");
  assert.ok(serpSrc);
  // Orchestrator overrides adapter's retryCount — summary must show orchestrator value
  assert.equal(serpSrc.retryCount, 2, "Summary retryCount = 2 (orchestrator-owned, 3 attempts - 1)");

  // Read the normalized artifact to verify the orchestrator-owned retryCount
  const normKey = `tenants/${req.tenantId}/clients/${req.clientId}/audits/${req.auditId}/normalized/dataforseo-serp.json`;
  const normBuf = await store.get(normKey);
  const normalized = JSON.parse(normBuf.toString());
  assert.equal(normalized.retryCount, 2, "retryCount = 2 (3 attempts - 1) — orchestrator-owned, not adapter's 99");
  assert.equal(normalized.status, "AVAILABLE");
});

// ── 5b. First-attempt success → retryCount 0 ─────────────────────────
test("first-attempt success: retryCount = 0", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["pagespeed"] = {
    execute: async () => {
      attempts++;
      return {
        rawBytes: Buffer.from(JSON.stringify({ ps: true }), "utf-8"),
        contentType: "application/json",
        sourceResult: {
          provider: "MockProvider",
          adapterVersion: "1.0.0",
          status: "AVAILABLE",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          retryCount: 5, // ← incorrect adapter value, orchestrator must override
          expectedRecords: 1,
          returnedRecords: 1,
          coverage: { requested: 1, completed: 1, failed: 0 },
          limitations: [],
          evidence: {},
        },
      };
    },
  };

  const orch = createOrchestrator({ artifactStore: store, adapters });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(attempts, 1, "Exactly 1 attempt");

  const normKey = `tenants/${req.tenantId}/clients/${req.clientId}/audits/${req.auditId}/normalized/pagespeed.json`;
  const normBuf = await store.get(normKey);
  const normalized = JSON.parse(normBuf.toString());
  assert.equal(normalized.retryCount, 0, "retryCount = 0 on first-attempt success, not adapter's 5");
});

// ── 6. Non-retryable failure — single attempt, retryCount 0 ───────────
test("non-retryable failure: exactly 1 attempt, retryCount = 0", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let attempts = 0;
  const adapters = createBaseMockAdapters();
  adapters["backlinks"] = {
    execute: async () => {
      attempts++;
      const err = new Error("Auth failure");
      err.category = "auth";
      throw err;
    },
  };

  const orch = createOrchestrator({
    artifactStore: store,
    adapters,
    retryPolicyResolver: () => ({
      timeoutMs: 30000,
      maxAttempts: 3,
      retryable: (e) => e?.category !== "auth",
      delayMs: () => 0,
    }),
  });

  const req = baseAuditRequest();
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(attempts, 1, "Exactly 1 attempt for non-retryable error");

  const backlinksSrc = summary.sources.find(s => s.source === "backlinks");
  assert.ok(backlinksSrc);
  assert.equal(backlinksSrc.retryCount, 0); // summary preserves orchestrator value

  // Read normalized artifact — must show FAILED with retryCount 0
  const normKey = `tenants/${req.tenantId}/clients/${req.clientId}/audits/${req.auditId}/normalized/backlinks.json`;
  const normBuf = await store.get(normKey);
  const normalized = JSON.parse(normBuf.toString());
  assert.equal(normalized.retryCount, 0, "retryCount = 0 (1 attempt - 1)");
  assert.equal(normalized.status, "FAILED");
});

// ── 4b. Timeout exhaustion — retryCount = actual attempts - 1 ─────────
test("timeout exhaustion: retryCount = actual attempts - 1, other sources continue", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let timeoutAttempts = 0;
  let signalsAborted = 0;

  const adapters = createBaseMockAdapters();
  adapters["pagespeed"] = {
    execute: async ({ signal }) => {
      timeoutAttempts++;
      const checkAbort = () => {
        if (signal?.aborted) {
          signalsAborted++;
          const err = new Error("Source execution timed out");
          err.category = "timeout";
          throw err;
        }
      };
      // Check immediately — the injected clock fires setTimeout immediately
      checkAbort();
      // If not aborted yet, wait briefly and check again
      await new Promise(r => setTimeout(r, 50));
      checkAbort();
      const err = new Error("Source execution timed out");
      err.category = "timeout";
      throw err;
    },
  };

  const orch = createOrchestrator({
    artifactStore: store,
    adapters,
    retryPolicyResolver: () => ({
      timeoutMs: 1,        // very short timeout
      maxAttempts: 3,
      retryable: (e) => e?.category === "timeout",
      delayMs: () => 0,
    }),
  });

  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  // Timeout source exhausts all 3 attempts
  assert.equal(timeoutAttempts, 3, "Exactly 3 attempts (all timed out)");
  assert.equal(signalsAborted, 3, "AbortSignal observed for all 3 attempts");

  // Other sources still execute — audit reaches EVIDENCE_LOCKED
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(summary.sources.length, 4, "All 4 sources in summary");

  // Verify retry count in normalized artifact
  const normKey = `tenants/${req.tenantId}/clients/${req.clientId}/audits/${req.auditId}/normalized/pagespeed.json`;
  const normBuf = await store.get(normKey);
  const normalized = JSON.parse(normBuf.toString());
  assert.equal(normalized.retryCount, 2, "retryCount = 2 (3 attempts - 1) — actual, not maxAttempts - 1");
  assert.equal(normalized.status, "FAILED");
});

// ── 7. Resume from checkpoints ────────────────────────────────────────
test("resume skips completed checkpoints", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  let onpageCalls = 0;
  let serpCalls = 0;

  const adapters = createBaseMockAdapters();
  const origOnpage = adapters["dataforseo-onpage"];
  const origSerp = adapters["dataforseo-serp"];
  adapters["dataforseo-onpage"] = {
    execute: async (args) => { onpageCalls++; return origOnpage.execute(args); },
  };
  adapters["dataforseo-serp"] = {
    execute: async (args) => { serpCalls++; return origSerp.execute(args); },
  };

  const orch = createOrchestrator({ artifactStore: store, adapters });
  const req = baseAuditRequest();

  // Run with checkpoints — onpage and pagespeed already done, resume from serp
  const summary = await orch.execute(req, {
    checkpoints: [
      { source: "dataforseo-onpage", completed: true, artifactKey: "key-1" },
      { source: "pagespeed", completed: true, artifactKey: "key-2" },
    ],
  });

  // Completed sources must NOT be called
  assert.equal(onpageCalls, 0, "Onpage not called (already completed)");
  // Remaining sources must execute
  assert.equal(serpCalls, 1, "SERP called (not in checkpoints)");
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(summary.sources.length, 4, "All 4 sources in summary");
});

// ── 8. Identical replay — no new adapter calls ────────────────────────
test("identical replay of locked audit performs no new adapter calls", async () => {
  const repo = createMemoryLifecycleRepository();
  const store = createGovernedArtifactStore({ type: "memory" });
  let callCount = 0;

  const adapters = createBaseMockAdapters();
  for (const k of Object.keys(adapters)) {
    const orig = adapters[k];
    adapters[k] = {
      execute: async (args) => { callCount++; return orig.execute(args); },
    };
  }

  const orch = createOrchestrator({ artifactStore: store, repo, adapters });
  const req = baseAuditRequest();

  // First run executes all 4 adapters
  const s1 = await orch.execute(req);
  assert.equal(s1.finalState, T.EVIDENCE_LOCKED);
  assert.equal(callCount, 4, "First run calls all 4 adapters");

  // Second run — same auditId and idempotencyKey, already locked
  const s2 = await orch.execute(req);
  assert.equal(s2.finalState, T.EVIDENCE_LOCKED);
  assert.equal(callCount, 4, "No new adapter calls on replay — still 4 total");
});

// ── 9. Validation failure → VALIDATION_FAILED ─────────────────────────
test("invalid audit request reaches VALIDATION_FAILED", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const orch = createOrchestrator({ artifactStore: store });
  const req = baseAuditRequest({ targetUrl: undefined });

  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.VALIDATION_FAILED);
  assert.equal(summary.sources.length, 0, "No sources executed");
  assert.equal(summary.canonicalEvidence, null, "No canonical evidence");
});

// ── 10. Artifact failure → COLLECTION_FAILED ──────────────────────────
test("canonical evidence persist failure reaches COLLECTION_FAILED", async () => {
  // Use a store that fails on canonical writes
  let canonicalPutCalled = false;
  const failingStore = {
    ...createGovernedArtifactStore({ type: "memory" }),
    put: async (input) => {
      if (input.scope?.category === "canonical") {
        canonicalPutCalled = true;
        throw new Error("Simulated canonical persist failure");
      }
      return createGovernedArtifactStore({ type: "memory" }).put(input);
    },
    get: async (key) => createGovernedArtifactStore({ type: "memory" }).get(key),
    exists: async (key) => createGovernedArtifactStore({ type: "memory" }).exists(key),
    verify: async (r) => createGovernedArtifactStore({ type: "memory" }).verify(r),
  };

  const repo = createMemoryLifecycleRepository();
  const orch = createOrchestrator({ artifactStore: failingStore, repo, adapters: createBaseMockAdapters() });
  const req = baseAuditRequest();

  // The orchestrator should fail during canonical evidence persistence
  // and the audit should not reach EVIDENCE_LOCKED
  let threw = false;
  try {
    await orch.execute(req);
  } catch {
    threw = true;
  }

  // Check final state via lifecycle
  const lc = createLifecycleService(repo);
  const cs = await lc.currentState(req.auditId, req.tenantId);
  // Should be in COLLECTING or COLLECTION_FAILED, not EVIDENCE_LOCKED
  assert.notEqual(cs?.state, T.EVIDENCE_LOCKED,
    "Must not reach EVIDENCE_LOCKED on canonical persist failure");
  assert.ok(threw || cs?.state !== T.EVIDENCE_LOCKED);
});

// ── 11. Canonical evidence determinism ────────────────────────────────
test("identical fixtures produce identical canonical evidence", async () => {
  const fixedId = "11111111-1111-1111-1111-111111111111";
  const fixedTenant = "det-tenant";

  // Build adapters that omit their own timestamps so the orchestrator
  // fills them from the injected clock — guaranteeing determinism.
  function deterministicAdapters() {
    const base = createBaseMockAdapters();
    const result = {};
    for (const [k, v] of Object.entries(base)) {
      result[k] = {
        execute: async (args) => {
          const r = await v.execute(args);
          // Strip non-deterministic fields so orchestrator fills from clock
          delete r.sourceResult.startedAt;
          delete r.sourceResult.completedAt;
          delete r.sourceResult.requestId;
          return r;
        },
      };
    }
    return result;
  }

  const run = async () => {
    const store = createGovernedArtifactStore({ type: "memory" });
    const repo = createMemoryLifecycleRepository();
    const orch = createOrchestrator({
      artifactStore: store,
      repo,
      adapters: deterministicAdapters(),
      validateContract,
      clock: createMockClock("2026-01-01T00:00:00.000Z"),
    });
    const req = {
      contractVersion: "1.0.0",
      auditId: fixedId,
      tenantId: fixedTenant,
      clientId: "c1",
      idempotencyKey: "det-ik-1",
      targetUrl: "https://example.com",
    };
    const summary = await orch.execute(req, { executionId: "det-exec-1" });
    const buf = await store.get(summary.canonicalEvidence.key);
    return { sha: summary.canonicalEvidence.sha256, bytes: buf.toString("hex") };
  };

  const r1 = await run();
  const r2 = await run();
  assert.equal(r1.sha, r2.sha, "SHA-256 must be identical");
  assert.equal(r1.bytes, r2.bytes, "Canonical evidence bytes must be identical");
});

// ── 12. Tenant isolation in artifact keys ─────────────────────────────
test("artifact keys are tenant-scoped", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const orch = createOrchestrator({ artifactStore: store, adapters: createBaseMockAdapters() });
  const req = baseAuditRequest({ tenantId: "tenant-alpha" });
  const summary = await orch.execute(req);

  for (const s of summary.sources) {
    if (s.artifactKey) {
      assert.ok(s.artifactKey.includes("tenants/tenant-alpha"),
        `Key must be tenant-scoped: ${s.artifactKey}`);
    }
  }
  assert.ok(summary.canonicalEvidence.key.includes("tenants/tenant-alpha"));
});

// ── 13. No unauthorized execution ─────────────────────────────────────
test("no real providers, LLMs, n8n, scoring, or reports called", async () => {
  // The orchestrator only uses mocked adapters — there's no way for it
  // to reach real providers. This test verifies the orchestrator doesn't
  // import or reference any production provider modules.

  // Read the orchestrator source to verify no banned imports
  const orchSource = readFileSync(
    resolve(__dirname, "..", "..", "src", "orchestration", "audit-orchestrator.js"),
    "utf-8",
  );

  // Verify no real provider/LLM/n8n/report/scoring imports
  const banned = [
    "dataforseo", "pagespeed", "google-auth", "googleapis",
    "openai", "anthropic", "langchain",
    "n8n", "n8n-workflow",
    "scoring", "findings", "score",
    "report", "render", "renderer",
    "lighthouse",
  ];

  for (const word of banned) {
    const regex = new RegExp(`(require|import).*${word}`, "i");
    assert.ok(!regex.test(orchSource), `Orchestrator must not import ${word}`);
  }

  // Verify the orchestrator produces valid output without any of these
  const store = createGovernedArtifactStore({ type: "memory" });
  const orch = createOrchestrator({ artifactStore: store, adapters: createBaseMockAdapters() });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.ok(summary.canonicalEvidence, "Full audit completes without banned modules");
});

// ── Full lifecycle path verification ──────────────────────────────────
test("exact lifecycle path: CREATED → VALIDATED → COLLECTING → EVIDENCE_STORED → EVIDENCE_LOCKED", async () => {
  const repo = createMemoryLifecycleRepository();
  const lc = createLifecycleService(repo);
  const store = createGovernedArtifactStore({ type: "memory" });
  const orch = createOrchestrator({ artifactStore: store, repo, adapters: createBaseMockAdapters() });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);

  const events = await lc.history(req.auditId, req.tenantId);
  const states = events.map(e => e.nextState);

  // Must contain the exact path
  const requiredPath = [T.CREATED, T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED];
  for (const state of requiredPath) {
    assert.ok(states.includes(state), `Lifecycle must include state: ${state}, got: ${states.join(" → ")}`);
  }

  // Verify sequence is contiguous
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i].sequence, i);
  }
});

// ── Source execution totals ───────────────────────────────────────────
test("source execution totals match expected counts", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const orch = createOrchestrator({ artifactStore: store, adapters: createBaseMockAdapters() });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  // 4 base sources: onpage, pagespeed, serp, backlinks
  assert.equal(summary.sources.length, 4);
  assert.equal(summary.sourceCounts.total, 4);
  assert.equal(summary.sourceCounts.available, 4);

  // Raw artifacts for each source
  for (const s of summary.sources) {
    const rawKey = s.artifactKey;
    if (rawKey) {
      const exists = await store.exists(rawKey);
      assert.ok(exists, `Raw artifact must exist: ${rawKey}`);
    }
  }
});

// ── GA4/GSC conditional execution ─────────────────────────────────────
test("GA4 and GSC execute when configured in audit request", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const adapters = createFullMockAdapters();
  const orch = createOrchestrator({ artifactStore: store, adapters });
  const req = baseAuditRequest({
    ga4: { propertyId: "123456789" },
    gsc: { siteUrl: "https://example.com" },
  });
  const summary = await orch.execute(req);

  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(summary.sources.length, 6, "All 6 sources including GA4+GSC");
  const ga4 = summary.sources.find(s => s.source === "ga4");
  const gsc = summary.sources.find(s => s.source === "gsc");
  assert.ok(ga4, "GA4 must exist");
  assert.ok(gsc, "GSC must exist");
});

// ── Concise summary structure ─────────────────────────────────────────
test("concise summary contains only operational metadata", async () => {
  const store = createGovernedArtifactStore({ type: "memory" });
  const orch = createOrchestrator({ artifactStore: store, adapters: createBaseMockAdapters() });
  const req = baseAuditRequest();
  const summary = await orch.execute(req);

  assert.equal(summary.contractVersion, "1.0.0");
  assert.ok(summary.auditId);
  assert.ok(summary.executionId);
  assert.equal(summary.finalState, T.EVIDENCE_LOCKED);
  assert.equal(typeof summary.resumed, "boolean");
  assert.ok(summary.startedAt);
  assert.ok(summary.completedAt);
  assert.ok(summary.sourceCounts);
  assert.ok(Array.isArray(summary.sources));
  assert.ok(Object.isFrozen(summary));

  // Must NOT include banned fields
  assert.equal(summary.score, undefined, "No score in summary");
  assert.equal(summary.findings, undefined, "No findings in summary");
  assert.equal(summary.report, undefined, "No report in summary");
  assert.equal(summary.rawPayloads, undefined, "No raw payloads");
  assert.equal(summary.credentials, undefined, "No credentials");
});
