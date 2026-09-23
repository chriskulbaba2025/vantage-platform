import test from "node:test";
import assert from "node:assert/strict";
import { projectEvidenceRecords } from "./evidence-record-projection.js";

const request = { tenantId: "tenant-a", clientId: "client-a", auditId: "00000000-0000-0000-0000-000000000010", targetUrl: "https://example.com" };

test("projects source and page evidence with stable scoped identity", () => {
  const records = projectEvidenceRecords({ auditRequest: request, allSourceResults: [{ source: "dataforseo-onpage", rawRecord: { key: "raw/onpage" }, sourceResult: { status: "AVAILABLE", completedAt: "2026-09-22T00:00:00Z", coverage: { requested: 1, completed: 1, failed: 0 }, evidence: { domain: "example.com", pages: [{ url: "https://example.com/pricing", title: "Pricing", status: 200, schemaTypes: ["Product"] }] } } }] });
  assert.equal(records.some((record) => record.evidenceType === "source:dataforseo-onpage"), true);
  const title = records.find((record) => record.evidenceType === "page:title");
  assert.equal(title.pageUrl, "https://example.com/pricing");
  assert.equal(title.providerArtifactRef, "raw/onpage");
  assert.equal(title.tenantId, "tenant-a");
});

test("missing page fields are omitted rather than fabricated", () => {
  const records = projectEvidenceRecords({ auditRequest: request, allSourceResults: [{ source: "dataforseo-onpage", sourceResult: { status: "PARTIAL", evidence: { pages: [{ url: "https://example.com/a" }] } } }] });
  assert.equal(records.some((record) => record.evidenceType === "page:title"), false);
  assert.equal(records.find((record) => record.evidenceType === "source:dataforseo-onpage").status, "PARTIAL");
});

test("same normalized observation is stable across repeated projection", () => {
  const input = { auditRequest: request, allSourceResults: [{ source: "pagespeed", sourceResult: { status: "AVAILABLE", completedAt: "2026-09-22T00:00:00Z", evidence: { mobile: { score: 80 } } } }] };
  assert.deepEqual(projectEvidenceRecords(input), projectEvidenceRecords(input));
});
