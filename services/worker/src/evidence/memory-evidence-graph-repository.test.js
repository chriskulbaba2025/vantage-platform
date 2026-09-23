import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryEvidenceGraphRepository } from "./memory-evidence-graph-repository.js";

test("memory evidence reads preserve the PostgreSQL row contract", async () => {
  const repository = createMemoryEvidenceGraphRepository();
  await repository.upsertEvidenceRecords([{
    tenantId: "tenant-a",
    auditId: "audit-a",
    evidenceId: "evidence-a",
    pageUrl: "https://a.example/",
    evidenceType: "page:title",
    observedValue: "A",
    status: "AVAILABLE",
    conflictState: "NONE",
  }]);
  const rows = await repository.listEvidence({ tenantId: "tenant-a", auditId: "audit-a" });
  assert.deepEqual(rows[0], {
    evidence_id: "evidence-a",
    tenant_id: "tenant-a",
    client_id: null,
    audit_id: "audit-a",
    website_id: null,
    page_url: "https://a.example/",
    source: "unknown",
    provider_artifact_ref: null,
    evidence_type: "page:title",
    observed_value: "A",
    normalized_value: null,
    observed_at: null,
    device: null,
    scope: null,
    lineage: null,
    independence: null,
    provenance: null,
    sufficiency: null,
    status: "AVAILABLE",
    conflict_state: "NONE",
    confidence: null,
    raw_evidence_ref: null,
  });
});

test("memory evidence reads remain tenant and audit scoped", async () => {
  const repository = createMemoryEvidenceGraphRepository();
  await repository.upsertEvidenceRecords([{ tenantId: "tenant-a", auditId: "audit-a", evidenceId: "a", evidenceType: "trust", status: "AVAILABLE" }]);
  await repository.upsertEvidenceRecords([{ tenantId: "tenant-b", auditId: "audit-b", evidenceId: "b", evidenceType: "trust", status: "AVAILABLE" }]);
  assert.deepEqual((await repository.listEvidence({ tenantId: "tenant-a", auditId: "audit-a" })).map((row) => row.evidence_id), ["a"]);
  assert.deepEqual(await repository.listEvidence({ tenantId: "tenant-a", auditId: "audit-b" }), []);
});

