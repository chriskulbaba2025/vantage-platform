import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createAuditOrchestrator } from "./audit-orchestrator.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { LIFECYCLE_STATE as T } from "../lifecycle/state-enum.js";
import { buildArtifactKey } from "../storage/artifact-key.js";

// PRYSM-NEXT-01 WP-E-04 — orchestrator runs the validation step through the
// REAL collection boundaries with an injected mock validator.  Zero live
// browsers (the mock replaces the whole validation call).

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = resolve(__dirname, "..", "contracts");
const _ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(_ajv);
for (const f of readdirSync(schemasDir).filter((x) => x.endsWith(".schema.json"))) {
  _ajv.addSchema(
    JSON.parse(readFileSync(resolve(schemasDir, f), "utf-8")),
    `https://vantage-platform.io/prysm/contracts/v1/${f}`,
  );
}
function validateContract(sid, obj) {
  const v = _ajv.getSchema(sid);
  if (!v) return { valid: false, errors: [{ message: `Schema not loaded: ${sid}` }] };
  const valid = v(obj);
  return { valid, errors: v.errors || [] };
}

const NOW = "2026-01-01T00:00:00.000Z";

function siteSourceResult() {
  return {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source: "dataforseo-onpage",
    provider: "DataForSEO",
    adapterVersion: "1.1.0",
    status: "AVAILABLE",
    startedAt: NOW,
    completedAt: NOW,
    retryCount: 0,
    expectedRecords: 3,
    returnedRecords: 3,
    coverage: { requested: 3, completed: 3, failed: 0 },
    limitations: [],
    evidence: {
      sourceStatus: "AVAILABLE",
      targetUrl: "https://x.com/",
      domain: "x.com",
      pageCount: 3,
      pages: [
        { crawledUrl: "https://x.com/", url: "https://x.com/", title: "Home", headings: { h1: ["Home"], h2: [], h3: [], h4: [] }, forms: [], ctas: [], status: 200 },
        { crawledUrl: "https://x.com/services/coaching", url: "https://x.com/services/coaching", title: "Coaching Services", headings: { h1: ["Coaching"], h2: [], h3: [], h4: [] }, forms: [], ctas: [], status: 200 },
        { crawledUrl: "https://x.com/contact", url: "https://x.com/contact", title: "Contact Us", headings: { h1: ["Contact"], h2: [], h3: [], h4: [] }, forms: [{ action: "/submit" }], ctas: [{ text: "Book Now", url: "https://x.com/book", kind: "link" }], status: 200 },
      ],
      services: ["Coaching"],
      platform: "WordPress",
      topicKeywords: ["coaching"],
      ctas: [{ text: "Book Now", url: "https://x.com/book", kind: "link" }],
      forms: [{ action: "/submit" }],
      externalCtas: [],
      socialLinks: [],
      schemaTypes: [],
      trust: { testimonials: false, credentials: false, caseStudies: false, faq: false, pricing: false, policies: false, contact: true },
      securityHeaders: { xFrameOptions: true, xContentTypeOptions: true, referrerPolicy: true, contentSecurityPolicy: true },
      statusCounts: { "200": 3 },
      totalWords: 300, averageWords: 100,
      missingTitles: 0, missingDescriptions: 0, missingCanonicals: 0,
      h1Missing: 0, h1Multiple: 0,
      imageCount: 0, imagesMissingAlt: 0,
      internalLinkCount: 2, brokenInternalLinks: [],
      _contentEvidenceAvailable: true,
      _responseHeadersAvailable: true,
      collectedAt: NOW,
    },
  };
}

function perfSourceResult() {
  return {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source: "pagespeed",
    provider: "pagespeed-insights",
    adapterVersion: "1.1.0",
    status: "AVAILABLE",
    startedAt: NOW,
    completedAt: NOW,
    retryCount: 0,
    coverage: { requested: 2, completed: 2, failed: 0 },
    limitations: [],
    evidence: {
      sourceStatus: "AVAILABLE",
      provider: "pagespeed-insights",
      mobile: { status: "AVAILABLE", source: "psi", scores: { performance: 80 }, metrics: {} },
      desktop: { status: "AVAILABLE", source: "psi", scores: { performance: 90 }, metrics: {} },
      fieldData: {},
      testedUrls: ["https://x.com/"],
      collectedAt: NOW,
    },
  };
}

function emptySourceResult(source, provider, adapterVersion = "1.0.0") {
  return {
    contractVersion: "1.0.0",
    schemaVersion: "1.0.0",
    source,
    provider,
    adapterVersion,
    status: "NOT_APPLICABLE",
    startedAt: NOW,
    completedAt: NOW,
    retryCount: 0,
    coverage: { requested: 0, completed: 0, failed: 0 },
    limitations: [],
    evidence: { sourceStatus: "NOT_APPLICABLE", collectedAt: NOW },
  };
}

function buildAdapters() {
  const stub = (sourceResult) => async () => ({ rawBytes: null, contentType: null, sourceResult });
  return {
    "dataforseo-onpage": { adapterVersion: "1.1.0", execute: stub(siteSourceResult()) },
    pagespeed: { adapterVersion: "1.1.0", execute: stub(perfSourceResult()) },
    "dataforseo-serp": { adapterVersion: "1.0.0", execute: stub(emptySourceResult("dataforseo-serp", "DataForSEO")) },
    backlinks: { adapterVersion: "1.0.0", execute: stub(emptySourceResult("backlinks", "DataForSEO")) },
    ga4: { adapterVersion: "1.0.0", execute: stub(emptySourceResult("ga4", "Google")) },
    gsc: { adapterVersion: "1.0.0", execute: stub(emptySourceResult("gsc", "Google")) },
  };
}

async function runToEvidenceLocked({ validatorImpl }) {
  const auditId = randomUUID();
  const tenantId = "t1";
  const clientId = "c1";
  const auditRequest = {
    contractVersion: "1.0.0",
    auditId,
    tenantId,
    clientId,
    idempotencyKey: randomUUID(),
    targetUrl: "https://x.com",
    businessName: "X",
    services: ["Coaching"],
    competitors: [],
  };

  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  const lifecycleService = createLifecycleService(createMemoryLifecycleRepository());
  const orchestrator = createAuditOrchestrator({
    lifecycleService,
    artifactStore,
    adapters: buildAdapters(),
    validateContract,
    clock: { now: () => NOW, sleep: async () => {}, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 100)) },
    narrativeMode: "mock",
    conversionPathValidatorImpl: validatorImpl,
  });

  let result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
  let previous = null;
  for (let step = 0; step < 6; step++) {
    if (result.finalState === previous) break;
    previous = result.finalState;
    if (result.finalState !== T.EVIDENCE_LOCKED) break;
    result = await orchestrator.execute(auditRequest, { executionId: randomUUID() });
  }
  const pastLocked = new Set([T.EVIDENCE_LOCKED, T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY, T.DRAFT_RENDERED]);
  assert.ok(pastLocked.has(result.finalState), `pipeline reached evidence_locked or later (got ${result.finalState})`);
  return { artifactStore, auditId, tenantId, clientId };
}

async function readCanonical(artifactStore, scope, name) {
  const key = buildArtifactKey({ ...scope, category: "canonical", artifactName: name });
  const bytes = await artifactStore.get(key);
  return JSON.parse(Buffer.from(bytes).toString("utf-8"));
}

test("WP-E-04: orchestrator persists schema-valid validation evidence and upgrades the capability", async () => {
  const validatorCalls = [];
  const mockValidator = async ({ targetUrl, keyPages, options }) => {
    validatorCalls.push({ targetUrl, keyPages, options });
    return {
      provider: "playwright-conversion-path",
      status: "PASS",
      pages: keyPages.map((kp, i) => ({
        url: kp.url,
        role: kp.role ?? null,
        status: "PASS",
        checks: {
          desktop: { cta: { found: true, visible: true, interactable: true, target: "https://x.com/book", targetResolves: true, obstructed: false } },
          mobile: { cta: { found: true, visible: true, interactable: true, target: "https://x.com/book", targetResolves: true, obstructed: false } },
        },
        limitations: [],
        screenshotRef: null,
        _screenshotBuffer: i === 0 ? Buffer.from("fake-png") : null,
      })),
      summary: { requested: keyPages.length, pass: keyPages.length, partial: 0, failed: 0, notAssessed: 0 },
      limitations: [],
    };
  };

  const { artifactStore, auditId, tenantId, clientId } = await runToEvidenceLocked({ validatorImpl: mockValidator });
  const scope = { tenantId, clientId, auditId };

  assert.ok(validatorCalls.length >= 1, "mock validator invoked");
  assert.equal(validatorCalls[0].options.allowLiveBrowser, false, "no live-browser opt-in in controlled requests");
  assert.ok(validatorCalls[0].keyPages.length >= 1, "key pages derived from site evidence");

  const validation = await readCanonical(artifactStore, scope, "conversion-path-validation.json");
  assert.equal(validation.status, "PASS");
  const sv = validateContract(
    "https://vantage-platform.io/prysm/contracts/v1/conversion-path-validation.schema.json",
    validation,
  );
  assert.equal(sv.valid, true, "persisted validation evidence is schema-valid");

  const capability = await readCanonical(artifactStore, scope, "capability-evidence.json");
  const pathCap = capability.capabilities["conversion.path"];
  assert.equal(pathCap.validated, true, "capability upgraded to validated");
  assert.equal(pathCap.validatedBy, "playwright-conversion-path");
  assert.equal(pathCap.validationSummary.pass, validatorCalls[0].keyPages.length);

  // Screenshot artifact persisted for the first page.
  const shotKey = buildArtifactKey({ ...scope, category: "evidence", artifactName: "path-validation-0.png" });
  const shot = await artifactStore.get(shotKey);
  assert.ok(shot && shot.length > 0, "screenshot evidence persisted");
});

test("WP-E-04: validator NOT_ASSESSED persists honest evidence; capability stays inferred", async () => {
  const mockValidator = async () => ({
    provider: "playwright-conversion-path",
    status: "NOT_ASSESSED",
    pages: [],
    summary: { requested: 2, pass: 0, partial: 0, failed: 0, notAssessed: 2 },
    limitations: ["Browser launch failed"],
  });

  const { artifactStore, auditId, tenantId, clientId } = await runToEvidenceLocked({ validatorImpl: mockValidator });
  const scope = { tenantId, clientId, auditId };

  const validation = await readCanonical(artifactStore, scope, "conversion-path-validation.json");
  assert.equal(validation.status, "NOT_ASSESSED");
  assert.ok(validation.limitations.some((l) => l.includes("launch failed")));

  const capability = await readCanonical(artifactStore, scope, "capability-evidence.json");
  assert.equal(capability.capabilities["conversion.path"].validated, false, "no validation → inferred state");
});
