#!/usr/bin/env node
/**
 * PDV4 assembled regressions. These deliberately use the production On-Page
 * adapter, governed DecisionEvidence persistence/read-back, real finding
 * production/persistence, and the finalization consumer. They are kept
 * separate from leaf tests so the Whole-App gate cannot mistake unit coverage
 * for the persistence handoff required by P-B14/P-B15.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execute as executeOnpage } from "../src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.js";
import { createProductionContractValidator } from "../src/application/production-bootstrap.js";
import { createMemoryArtifactStore } from "../src/storage/memory-artifact-store.js";
import { createGovernedArtifactStore, buildArtifactKey } from "../src/storage/governed-artifact-store.js";
import { buildDecisionEvidence, persistDecisionEvidence, loadAndValidateDecisionEvidence } from "../src/evidence/decision-evidence.js";
import { persistFindings } from "../src/scoring/scoring-service.js";
import { scoreAudit } from "../src/scoring/vantage-score.js";
import { runFinalizationGate } from "../src/scoring/report-finalization-gate.js";

const validateContract = createProductionContractValidator();
const store = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
const scope = { tenantId: "pdv4-assembled", clientId: "controlled", auditId: randomUUID() };

function check(label, condition) {
  assert.ok(condition, label);
  console.log(`  [x] ${label}`);
}

function fixtures({ partial = false, noImageAlt = 223, noH1 = 2 } = {}) {
  return {
    taskPost: { taskId: "pdv4-controlled" }, pollTask: { status: "ready" },
    summary: {
      crawl_status: { pages_crawled: 2, max_crawl_pages: 10, crawl_stop_reason: partial ? "limit_exceeded" : "" },
      domain_info: { checks: {} },
      page_metrics: { links_internal: 3, checks: { no_image_alt: noImageAlt, no_h1_tag: noH1 } },
    },
    pages: { total_count: 2, items: [{
      url: "https://pdv4.example.test/", status_code: 200,
      meta: { title: "PDV4 evidence", description: "Controlled evidence", h1: [], h2: ["Service"], word_count: 250, content_language: "en", structured_data_types: ["Organization"], plain_text: "Controlled body content." },
      checks: {}, resources: { buttons: [], forms: [] },
    }] },
    links: { items: [], total_count: 0 }, duplicate_tags: { items: [] }, duplicate_content: { items: [] }, microdata: { items: [] },
    content_parsing: [{ url: "https://pdv4.example.test/", result: { main_content: [{ text: "Controlled body content." }], secondary_content: [], plain_text_word_count: 4 } }],
  };
}

async function persistedEvidence(sourceResult, auditId) {
  const localScope = { ...scope, auditId };
  const { evidence, errors } = buildDecisionEvidence({ allSourceResults: [{ source: "dataforseo-onpage", sourceResult }], suppliedCompetitors: [], validateContract });
  assert.deepEqual(errors, [], `DecisionEvidence hydration errors: ${JSON.stringify(errors)}`);
  await persistDecisionEvidence({ store, scope: localScope, evidence, validateContract });
  return { scope: localScope, evidence: await loadAndValidateDecisionEvidence({ store, scope: localScope, validateContract }) };
}

function finalizationModel(evidence, findings = []) {
  return { scores: { performance: null }, findings, assessedWeight: 100, evidenceConfidenceScore: 50, evidence };
}

console.log("PDV4 assembled finalization regressions");

// P-B14: real adapter output -> DecisionEvidence persisted/read back -> consumer.
const pB14 = await executeOnpage({
  auditRequest: { targetUrl: "https://pdv4.example.test/", auditId: "pdv4-pb14", services: [], crawl: { fixtures: fixtures(), maxPages: 10 } },
  source: "dataforseo-onpage", executionId: "pdv4-pb14", attempt: 1,
});
const { evidence: pB14Evidence } = await persistedEvidence(pB14.sourceResult, randomUUID());
check("P-B14 adapter keeps positive image numerator", pB14Evidence.site.imagesMissingAlt === 223);
check("P-B14 persisted DecisionEvidence preserves unavailable image denominator", pB14Evidence.site._metaFieldAvailability?.images === false);
check("P-B14 schema persistence coerces unavailable imageCount to zero", pB14Evidence.site.imageCount === 0);
check("P-B14 deep-content availability does not erase image unavailability", pB14Evidence.site._contentEvidenceAvailable === true);
const pB14Gate = runFinalizationGate(finalizationModel(pB14Evidence), pB14Evidence);
check("P-B14 finalization accepts bounded positive image evidence", !pB14Gate.errors.some((error) => error.field === "site.imagesMissingAlt"));

// P-B15: real deterministic scoring producer -> FindingSet persistence/read back -> consumer.
const pB15 = await executeOnpage({
  auditRequest: { targetUrl: "https://pdv4.example.test/", auditId: "pdv4-pb15", services: [], crawl: { fixtures: fixtures({ partial: true }), maxPages: 10 } },
  source: "dataforseo-onpage", executionId: "pdv4-pb15", attempt: 1,
});
const { scope: pB15Scope, evidence: pB15Evidence } = await persistedEvidence(pB15.sourceResult, randomUUID());
check("P-B15 source remains PARTIAL through persisted DecisionEvidence", pB15Evidence.site.sourceStatus === "PARTIAL");
const producedModel = scoreAudit({ auditId: pB15Scope.auditId, services: [] }, pB15Evidence);
const producedFinding = producedModel.findings.find((finding) => finding.ruleId === "VAN-TECH-002");
check("P-B15 deterministic producer emits assessed-scope wording", /assessed pages missing H1;.*unassessed pages remain unknown/i.test(producedFinding?.evidenceText || ""));
await persistFindings({ store, scope: pB15Scope, findings: [producedFinding], validateContract });
const findingsKey = buildArtifactKey({ ...pB15Scope, category: "canonical", artifactName: "findings.json" });
const reloadedFinding = JSON.parse(Buffer.from(await store.get(findingsKey)).toString("utf8"))[0];
check("P-B15 validated FindingSet reload preserves bounded wording", reloadedFinding.evidenceText === producedFinding.evidenceText);
const pB15Gate = runFinalizationGate(finalizationModel(pB15Evidence, [reloadedFinding]), pB15Evidence);
check("P-B15 finalization accepts the persisted assessed-scope finding", !pB15Gate.errors.some((error) => error.field === "findings[].evidence"));

console.log("PDV4 ASSEMBLED FINALIZATION REGRESSIONS: PASS");
