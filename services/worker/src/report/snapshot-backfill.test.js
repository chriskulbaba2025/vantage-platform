import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { buildArtifactKey } from "../storage/governed-artifact-store.js";
import { ensurePersistedSnapshotV1, snapshotV1ArtifactName } from "./snapshot-backfill.js";

const scope = {
  tenantId: "tenant-reboot",
  clientId: "rebootbusinesscoaching.com-reboot-business-coaching",
  auditId: "c11d9781-878b-4236-a72a-16e5d7198843",
};

function canonicalStore(forScope = scope) {
  const store = createMemoryArtifactStore();
  const values = {
    "audit-request.json": {
      ...forScope,
      businessName: forScope === scope ? "Reboot Business Coaching" : "Arbitrary Compatible Audit",
      targetUrl: forScope === scope ? "https://rebootbusinesscoaching.com/" : "https://arbitrary-compatible.example/",
      report: { snapshotVersion: "1.0.0" },
    },
    "decision-evidence.json": {
      auditId: forScope.auditId,
      site: {
        domain: forScope === scope ? "rebootbusinesscoaching.com" : "arbitrary-compatible.example",
        collectedAt: "2026-09-27T00:00:00.000Z",
        pages: [],
        identityCandidates: [{ source: "site-identity", value: forScope === scope ? "Reboot Business Coaching" : "Arbitrary Compatible Audit" }],
        services: ["Business coaching"],
        ctas: [{ text: "Book a consultation", url: "https://rebootbusinesscoaching.com/contact" }],
        trust: { contact: true },
      },
    },
    "findings.json": [],
    "scores.json": {
      contractVersion: "2.0.0",
      auditId: forScope.auditId,
      scores: { conversionReadiness: 61 },
      bands: { conversionReadiness: "Developing" },
      readinessStatus: "Complete",
      rootCauseRuleId: null,
      decisionHierarchy: { hierarchyVersion: "1.0.0", rootCauseRuleId: null, orderedFindingIds: [], actions: [] },
    },
    "report-content.json": {
      auditId: forScope.auditId,
      business: { name: forScope === scope ? "Reboot Business Coaching" : "Arbitrary Compatible Audit", domain: forScope === scope ? "rebootbusinesscoaching.com" : "arbitrary-compatible.example" },
      scores: { conversionReadiness: 61 },
      bands: { conversionReadiness: "Developing" },
      siteMetrics: { services: ["Business coaching"] },
      findings: [],
      competitors: [],
      limitations: [],
      showNumericScore: true,
    },
  };
  return Promise.all(Object.entries(values).map(([artifactName, value]) => store.put({
    bytes: Buffer.from(JSON.stringify(value)),
    contentType: "application/json",
    scope: { ...forScope, category: artifactName === "report-content.json" ? "report" : "canonical", artifactName },
  }))).then(() => store);
}

test("historical Snapshot backfill renders once from persisted evidence and reopens identically", async () => {
  const store = await canonicalStore();
  const first = await ensurePersistedSnapshotV1({ store, scope });
  const second = await ensurePersistedSnapshotV1({ store, scope });

  assert.ok(first && first.length > 0);
  assert.deepEqual(second, first);
  assert.match(first.toString("utf8"), /Reboot Business Coaching/);
  assert.match(first.toString("utf8"), /PRYSM Snapshot/);
  assert.equal((first.toString("utf8").match(/class="page"/g) || []).length, 1);
  assert.ok(await store.exists(buildArtifactKey({ ...scope, category: "report-v2", artifactName: snapshotV1ArtifactName(first) })));
  assert.match(first.toString("utf8"), /prysm-snapshot-renderer/);
});

test("legacy Snapshot HTML is stale, reprojected from any compatible audit, and never overwrites unrelated artifacts", async () => {
  const arbitraryScope = {
    tenantId: "tenant-arbitrary",
    clientId: "another-compatible-client",
    auditId: "8c3f98a0-88cd-4b0e-bc7a-28a8d3bb4e31",
  };
  const store = await canonicalStore(arbitraryScope);
  const legacyKey = buildArtifactKey({ ...arbitraryScope, category: "report-v2", artifactName: "pages/snapshot.html" });
  const executiveKey = buildArtifactKey({ ...arbitraryScope, category: "report-v2", artifactName: "pages/index.html" });
  const legacy = Buffer.from("<!doctype html><html><body>legacy compact snapshot</body></html>");
  const executive = Buffer.from("executive baseline bytes");
  await store.put({ bytes: legacy, contentType: "text/html", scope: { ...arbitraryScope, category: "report-v2", artifactName: "pages/snapshot.html" } });
  await store.put({ bytes: executive, contentType: "text/html", scope: { ...arbitraryScope, category: "report-v2", artifactName: "pages/index.html" } });

  const previousCta = process.env.PRYSM_OMNIPRESENCE_BOOKING_URL;
  process.env.PRYSM_OMNIPRESENCE_BOOKING_URL = "https://calendly.com/brad-omnipresence/30min";
  const projected = await ensurePersistedSnapshotV1({ store, scope: arbitraryScope });
  if (previousCta === undefined) delete process.env.PRYSM_OMNIPRESENCE_BOOKING_URL;
  else process.env.PRYSM_OMNIPRESENCE_BOOKING_URL = previousCta;
  assert.notDeepEqual(projected, legacy);
  assert.match(projected.toString("utf8"), /prysm-snapshot-renderer/);
  assert.match(projected.toString("utf8"), /Arbitrary Compatible Audit/);
  assert.match(projected.toString("utf8"), /brad-grant-headshot\.jpeg/);
  assert.match(projected.toString("utf8"), /https:\/\/calendly\.com\/brad-omnipresence\/30min/);
  assert.doesNotMatch(projected.toString("utf8"), /Downloads|\$\s?\d/);
  assert.equal((await store.get(legacyKey)).toString(), legacy.toString());
  assert.equal((await store.get(executiveKey)).toString(), executive.toString());
  assert.ok(await store.exists(buildArtifactKey({ ...arbitraryScope, category: "report-v2", artifactName: snapshotV1ArtifactName(projected) })));
  assert.deepEqual(await ensurePersistedSnapshotV1({ store, scope: arbitraryScope }), projected);
});

test("Snapshot backfill fails truthfully when governed evidence is incomplete", async () => {
  const store = await canonicalStore();
  const missingKey = buildArtifactKey({ ...scope, category: "canonical", artifactName: "findings.json" });
  assert.equal(typeof missingKey, "string");
  // A store with only the request cannot be mistaken for a valid Snapshot.
  const incomplete = createMemoryArtifactStore();
  await incomplete.put({
    bytes: Buffer.from(JSON.stringify({ ...scope, businessName: "Reboot Business Coaching" })),
    contentType: "application/json",
    scope: { ...scope, category: "canonical", artifactName: "audit-request.json" },
  });
  assert.equal(await ensurePersistedSnapshotV1({ store: incomplete, scope }), null);
  assert.equal(await ensurePersistedSnapshotV1({ store, scope: { ...scope, tenantId: "wrong-tenant" } }), null);
});
