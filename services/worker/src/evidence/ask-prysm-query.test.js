import test from "node:test";
import assert from "node:assert/strict";
import { queryAskPrysm } from "./ask-prysm-query.js";

function repo(rows) { return { async listEvidence({ tenantId }) { return tenantId === "tenant-a" ? rows : []; } }; }

test("supported Ask PRYSM query returns governed citations", async () => {
  const result = await queryAskPrysm({ repository: repo([{ evidence_id: "ev-1", page_url: "https://example.com/pricing", evidence_type: "trust", status: "AVAILABLE", conflict_state: "NONE" }]), tenantId: "tenant-a", auditId: "audit-a", question: "What evidence supports this recommendation?" });
  assert.equal(result.supported, true);
  assert.equal(result.citations[0].evidenceId, "ev-1");
});

test("missing evidence stays explicit and does not become a defect", async () => {
  const result = await queryAskPrysm({ repository: repo([{ evidence_id: "ev-1", evidence_type: "pricing", status: "UNKNOWN", conflict_state: "NONE" }]), tenantId: "tenant-a", auditId: "audit-a", question: "What evidence is missing?" });
  assert.equal(result.supported, true);
  assert.match(result.answer, /matched|does not contain enough evidence/i);
  assert.equal(result.citations[0].status, "UNKNOWN");
});

test("conflicting evidence is returned as conflict, not silently resolved", async () => {
  const result = await queryAskPrysm({ repository: repo([{ evidence_id: "ev-1", evidence_type: "schema", status: "CONFLICT", conflict_state: "CONFLICT" }]), tenantId: "tenant-a", auditId: "audit-a", question: "What evidence is conflicting?" });
  assert.equal(result.citations[0].conflictState, "CONFLICT");
});

test("unsupported and cross-tenant questions fail closed", async () => {
  const result = await queryAskPrysm({ repository: repo([{ evidence_id: "secret", evidence_type: "secret", status: "AVAILABLE" }]), tenantId: "tenant-b", auditId: "audit-a", question: "Tell me the revenue outcome" });
  assert.equal(result.supported, false);
  assert.equal(result.citations.length, 0);
  const scoped = await queryAskPrysm({ repository: repo([{ evidence_id: "secret", evidence_type: "secret", status: "AVAILABLE" }]), tenantId: "tenant-b", auditId: "audit-a", question: "What evidence supports this?" });
  assert.equal(scoped.citations.length, 0);
});
