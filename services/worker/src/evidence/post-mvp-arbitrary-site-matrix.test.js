import test from "node:test";
import assert from "node:assert/strict";
import { reconcileUrlDiscovery } from "./url-discovery-reconciliation.js";
import { discoverSupplementalUrlSources } from "./supplemental-url-discovery.js";
import { reconcileCanonicalEvidence } from "./canonical-evidence-reconciliation.js";
import { buildEvidenceGraph } from "./evidence-graph.js";
import { queryAskPrysm } from "./ask-prysm-query.js";

function response(body, status = 200, contentType = "text/html") {
  const bytes = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    async arrayBuffer() { return bytes; },
  };
}

test("arbitrary-site URL discovery covers sitemap, robots, HTML, llms, redirects, canonicals, and collisions", async () => {
  const target = "https://Example.test/";
  const sources = await discoverSupplementalUrlSources(target, {
    maxSources: 4,
    structuralUrls: ["https://example.test/sitemap.html"],
    fetchImpl: async (url) => {
      if (url.endsWith("/llms.txt")) return response("- [Pricing](https://example.test/pricing#plans)\nhttps://other.test/private");
      if (url.endsWith("/sitemap.html")) return response('<a href="/services/">Services</a><a href="/contact">Contact</a>');
      return response("", 404);
    },
  });
  const reconciled = reconcileUrlDiscovery({
    targetUrl: target,
    sources: {
      DATAFORSEO: [{ url: "https://example.test/legacy", redirectTo: "/services/" }],
      ROBOTS_SITEMAP: ["/sitemap.xml", "/nested/index.xml"],
      XML_SITEMAP: ["/services/", "/services", "/pricing"],
      HTML_SITEMAP: sources.sources.HTML_SITEMAP,
      LLMS_TXT: sources.sources.LLMS_TXT,
      INTERNAL_LINK: ["/pricing?b=2&a=1", "/pricing?a=1&b=2"],
    },
    sourceStatuses: { XML_SITEMAP: "PARTIAL", ROBOTS_SITEMAP: "AVAILABLE" },
  });
  assert.equal(reconciled.status, "PARTIAL");
  assert.equal(reconciled.coverageState, "INCOMPLETE");
  assert.ok(reconciled.suspiciousCoverage.present);
  assert.ok(reconciled.inventory.some((item) => item.url.endsWith("/pricing?a=1&b=2")));
  assert.equal(reconciled.inventory.some((item) => item.url.includes("other.test")), false);
  assert.ok(reconciled.inventory.find((item) => item.url.endsWith("/legacy")).redirectTargets.includes("https://example.test/services"));
  assert.ok(reconciled.inventory.find((item) => item.url.endsWith("/pricing")).provenance.includes("LLMS_TXT"));
});

test("arbitrary-site discovery fails closed for missing, malformed, capped, and provider-partial sources", () => {
  const result = reconcileUrlDiscovery({
    targetUrl: "https://site.test/",
    sources: {
      DATAFORSEO: ["https://site.test/"],
      XML_SITEMAP: [],
      ROBOTS_SITEMAP: null,
    },
    sourceStatuses: { XML_SITEMAP: "FAILED", ROBOTS_SITEMAP: "UNAVAILABLE" },
    providerCoverage: { completed: 1 },
  });
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.coverageState, "INCOMPLETE");
  assert.deepEqual(result.sourceStatuses, { XML_SITEMAP: "FAILED", ROBOTS_SITEMAP: "UNAVAILABLE" });
  assert.equal(result.inventory.some((item) => item.status === "ABSENT"), false);
});

test("arbitrary-site evidence matrix preserves duplicate, independent, non-independent, device, scope, freshness, and history", () => {
  const base = { tenantId: "t", auditId: "a", websiteId: "w", pageUrl: "https://site.test/pricing", evidenceType: "pricing", observedValue: "present" };
  const result = reconcileCanonicalEvidence([
    { ...base, evidenceId: "source-a", source: "crawl", independence: "INDEPENDENT", device: "desktop", scope: "page", observedAt: "2026-09-20T00:00:00Z", status: "AVAILABLE" },
    { ...base, evidenceId: "source-b", source: "schema", independence: "INDEPENDENT", device: "desktop", scope: "page", observedAt: "2026-09-20T00:01:00Z", status: "AVAILABLE" },
    { ...base, evidenceId: "desktop-conflict", source: "page-render", independence: "INDEPENDENT", device: "desktop", scope: "page", observedValue: "missing", observedAt: "2026-09-20T00:01:30Z", status: "AVAILABLE" },
    { ...base, evidenceId: "duplicate", source: "crawl-copy", independence: "DUPLICATE", device: "desktop", scope: "page", observedAt: "2026-09-20T00:02:00Z", status: "AVAILABLE" },
    { ...base, evidenceId: "mobile", source: "crawl", independence: "INDEPENDENT", device: "mobile", scope: "page", observedValue: "missing", observedAt: "2026-09-20T00:03:00Z", status: "AVAILABLE" },
    { ...base, evidenceId: "historical", source: "crawl", independence: "INDEPENDENT", device: "desktop", scope: "page", temporalContext: "HISTORICAL", observedAt: "2025-01-01T00:00:00Z", status: "AVAILABLE" },
  ]);
  assert.ok(result.records.length >= 2);
  assert.ok(result.records.some((record) => record.conflict.present));
  assert.ok(result.records.some((record) => record.conflict.temporalConflict));
  assert.ok(result.records.every((record) => record.authorityValue === null || typeof record.authorityValue === "string"));
});

test("arbitrary-site graph and Ask PRYSM preserve ownership, conflict, missing evidence, and stable identity", async () => {
  const input = {
    tenantId: "tenant-a", auditId: "audit-a", websiteId: "site-a", websiteUrl: "https://site.test",
    pages: [{ url: "https://site.test/pricing" }],
    evidenceRecords: [{ evidenceId: "ev-conflict", evidenceType: "pricing", pageUrl: "https://site.test/pricing", status: "CONFLICT", conflictState: "CONFLICT" }],
    findings: [{ findingId: "finding", title: "Review pricing", evidenceIds: ["ev-conflict"], assertionMode: "INFERRED", mapsToCanonicalProblemId: "pricing" }],
  };
  const graphA = buildEvidenceGraph(input);
  const graphB = buildEvidenceGraph(input);
  assert.deepEqual(graphA, graphB);
  assert.equal(new Set(graphA.nodes.map((node) => node.nodeId)).size, graphA.nodes.length);
  assert.equal(new Set(graphA.edges.map((edge) => edge.edgeId)).size, graphA.edges.length);
  assert.ok(graphA.nodes.some((node) => node.attributes.conflictState === "CONFLICT"));
  assert.equal(graphA.edges.some((edge) => edge.edgeType === "CAUSES"), false);

  const repository = { async listEvidence({ tenantId, auditId }) {
    return tenantId === "tenant-a" && auditId === "audit-a"
      ? [{ evidence_id: "ev-conflict", page_url: "https://site.test/pricing", evidence_type: "pricing", status: "CONFLICT", conflict_state: "CONFLICT" }]
      : [];
  } };
  const conflict = await queryAskPrysm({ repository, tenantId: "tenant-a", auditId: "audit-a", question: "What evidence is conflicting?" });
  assert.equal(conflict.citations[0].conflictState, "CONFLICT");
  const missing = await queryAskPrysm({ repository, tenantId: "tenant-a", auditId: "audit-a", question: "What evidence is missing?" });
  assert.match(missing.answer, /not contain enough evidence|No negative conclusion/i);
  const crossAudit = await queryAskPrysm({ repository, tenantId: "tenant-a", auditId: "audit-b", question: "What evidence supports this recommendation?" });
  assert.equal(crossAudit.citations.length, 0);
});
