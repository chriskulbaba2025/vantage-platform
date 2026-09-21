import test from "node:test";
import assert from "node:assert/strict";
import { deriveNarrativeStates, validateNarrativeStateMap, NARRATIVE_STATE, EVIDENCE_SUFFICIENCY } from "./narrative-state.js";
import { renderReportV2 } from "../report/render-report-v2.js";

const truth = (state = "assessed", scope = "two reviewed pages", refs = ["fixture:evidence"]) => ({
  state, scope, observation: "Controlled fixture observation", clientConclusion: "Controlled fixture conclusion",
  qualifier: state === "partial" ? "Limited to the reviewed scope." : null,
  prohibitedUpgrades: ["site-wide certainty"], evidenceRefs: refs,
});

function fixture(overrides = {}) {
  const allTruth = {
    offerClarity: truth(), ctaClarity: truth(), conversionPathClarity: truth(),
    buyerQuestionCoverage: truth(), trustProof: truth(), performanceReadiness: truth("partial"),
    indexability: truth(), evidenceScope: truth(),
  };
  return {
    input: { targetUrl: "https://fixture.example", businessName: "Fixture Business", services: ["Consulting"], primaryGoal: "Book a call" },
    generatedAt: "2026-09-20T00:00:00.000Z", scores: { conversionReadiness: 80, performance: 75 }, bands: { conversionReadiness: "Strong" },
    findings: [], evidence: {
      site: { sourceStatus: "AVAILABLE", domain: "fixture.example", targetUrl: "https://fixture.example", pages: [], services: ["Consulting"], trust: {}, coverage: { requested: 2, completed: 2, failed: 0 } },
      performance: { sourceStatus: "AVAILABLE", mobile: { status: "AVAILABLE", source: "lab", scores: { performance: 60 }, metrics: {} }, desktop: { status: "AVAILABLE", source: "lab", scores: { performance: 90 }, metrics: {} }, fieldData: {}, coverage: { requested: 2, completed: 2, failed: 0 } },
      competitors: null, backlinks: null, ga4: null, gsc: null,
    },
    sourceStatus: { site: "AVAILABLE", performance: "AVAILABLE", competitors: "AVAILABLE" },
    capabilityEvidence: { capabilities: { "content.body": { status: "AVAILABLE", coverage: { requested: 2, completed: 2 } }, "performance.lab": { status: "AVAILABLE" } } },
    competitors: { comparisons: [{ name: "Fixture competitor", status: "AVAILABLE" }], opportunities: { gaps: [] } }, contentIdeas: {},
    crossReportInterpretation: { version: "2.0.0", contract: "CLIENT_TRUTH", constructs: { offerClarity: "fixture", ctaClarity: "fixture", conversionPathClarity: "fixture", trustProof: "fixture", mobileUsability: "fixture", indexability: "fixture" }, truth: { ...allTruth, ...(overrides.truth || {}) } },
    ...overrides,
  };
}

function run(overrides = {}) {
  const model = fixture(overrides);
  assert.ok(model.scores, "controlled fixture must include the report score object");
  return { model, states: deriveNarrativeStates(model), html: renderReportV2(model, { date: "2026-09-20" }) };
}

test("CASE 01 — Missing evidence cannot cause STRONG", () => {
  const { states } = run({ truth: { trustProof: truth("not assessed") } });
  assert.equal(states["trust-credibility"].state, NARRATIVE_STATE.INSUFFICIENT_EVIDENCE);
  assert.equal(states["trust-credibility"].evidenceSufficiency, EVIDENCE_SUFFICIENCY.INSUFFICIENT);
});

test("CASE 02 — Missing evidence cannot cause WEAK", () => {
  const { states, html } = run({ truth: { trustProof: truth("not assessed") } });
  assert.notEqual(states["trust-credibility"].state, NARRATIVE_STATE.WEAK);
  assert.match(html, /INSUFFICIENT_EVIDENCE/);
});

test("CASE 03 — A score alone cannot select narrative state", () => {
  const low = run({ scores: { conversionReadiness: 1 } }).states;
  const high = run({ scores: { conversionReadiness: 99 } }).states;
  assert.deepEqual(Object.fromEntries(Object.entries(low).map(([k, v]) => [k, v.state])), Object.fromEntries(Object.entries(high).map(([k, v]) => [k, v.state])));
});

test("CASE 04 — Finding count alone cannot select narrative state", () => {
  const base = run().states;
  const many = run({ findings: Array.from({ length: 30 }, () => ({ title: "Unassessed fixture", scoreBearing: false, actionable: false })) }).states;
  assert.equal(many["priority-fixes"].state, base["priority-fixes"].state);
});

test("CASE 05 — Severity alone cannot select narrative state", () => {
  const ordinary = run({ findings: [{ severity: "Low", scoreBearing: false }] }).states;
  const severe = run({ findings: [{ severity: "Critical", scoreBearing: false }] }).states;
  assert.equal(severe["priority-fixes"].state, ordinary["priority-fixes"].state);
});

test("CASE 06 — PARTIAL evidence is never rendered as complete coverage", () => {
  const { states, html } = run({ truth: { trustProof: truth("partial", "3 of 10 requested pages", ["fixture:partial"]) } });
  assert.equal(states["trust-credibility"].evidenceSufficiency, EVIDENCE_SUFFICIENCY.BOUNDED_PARTIAL);
  assert.equal(states["trust-credibility"].state, NARRATIVE_STATE.MIDDLE);
  assert.match(html, /3 of 10 requested pages|Limited to the reviewed scope/);
});

test("CASE 07 — A bounded assessed sample cannot become a site-wide claim", () => {
  const { states, html } = run({ truth: { buyerQuestionCoverage: truth("partial", "3 of 10 requested pages", ["fixture:sample"]) } });
  assert.equal(states["content-opportunities"].reviewedScope, "3 of 10 requested pages");
  assert.match(html, /3 of 10 requested pages/);
  assert.doesNotMatch(states["content-opportunities"].message, /site-wide/i);
});

test("CASE 08 — A common cause remains a diagnostic check, not a proven cause", () => {
  const { states, html } = run({ findings: [{ title: "Possible shared delay", scoreBearing: true, actionable: true, confidence: "directional", evidence: [{ field: "fixture:signal" }] }] });
  assert.equal(states["priority-fixes"].recommendationCertainty, "BOUNDED");
  assert.match(html, /Check these first|diagnostic/i);
});

test("CASE 09 — Competitor behavior alone cannot create a client recommendation", () => {
  const { states } = run({ sourceStatus: { competitors: "AVAILABLE" }, competitors: { comparisons: [{ name: "Example competitor", status: "AVAILABLE", observedBehavior: "More testimonials" }], opportunities: { gaps: [{ observedCompetitorCoverage: ["Testimonials"] }] } } });
  assert.notEqual(states["competitor-comparison"].state, NARRATIVE_STATE.WEAK);
  assert.match(states["competitor-comparison"].boundedAction, /act only on the client.s own established evidence/i);
});

test("CASE 10 — Search demand alone cannot create a content recommendation", () => {
  const baseline = run();
  const { states, html } = run({ contentIdeas: { leading: [{ query: "fixture high demand", searchDemand: 10000 }] } });
  assert.equal(states["content-opportunities"].state, NARRATIVE_STATE.STRONG);
  assert.equal(states["content-opportunities"].state, baseline.states["content-opportunities"].state);
  const text = html.replace(/<style\b[\s\S]*?<\/style>|<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /Content opportunities are qualified planning inputs\. They do not prove that a topic or answer is missing from the site\./i);
  assert.doesNotMatch(states["content-opportunities"].conditionFacts.join(" "), /fixture high demand/);
});

test("CASE 11 — Lab performance is not presented as field performance", () => {
  const { html } = run();
  assert.match(html, /Lab measurements describe the tested conditions/);
  assert.match(html, /not real-user field performance/i);
});

test("CASE 12 — Supporting Detail insufficiency suppresses certainty on every other page", () => {
  const { states, html } = run({ truth: { evidenceScope: truth("not assessed", "material evidence unavailable", ["fixture:missing"]) } });
  assert.equal(states["supporting-detail"].state, NARRATIVE_STATE.INSUFFICIENT_EVIDENCE);
  for (const [id, record] of Object.entries(states)) assert.equal(record.state, NARRATIVE_STATE.INSUFFICIENT_EVIDENCE, id);
  assert.match(html, /Supporting Detail could not establish the material evidence boundary/);
});

test("CASE 13 — Priority Fixes cannot give an established remedy for an unverified cause", () => {
  const { states, html } = run({ findings: [{ title: "Possible fixture issue", scoreBearing: true, actionable: true, confidence: "directional", evidence: [{ field: "fixture:signal" }] }] });
  assert.equal(states["priority-fixes"].recommendationCertainty, "BOUNDED");
  assert.match(states["priority-fixes"].boundedAction, /Check these first/);
  assert.doesNotMatch(html, /The cause is confirmed/);
});

test("CASE 14 — WEAK does not automatically authorize or recommend a rebuild", () => {
  const { states, html } = run({ truth: { trustProof: truth("finding") } });
  assert.equal(states["trust-credibility"].state, NARRATIVE_STATE.WEAK);
  for (const record of Object.values(states)) assert.equal(record.rebuildAuthorization.allowed, false);
  assert.match(states["trust-credibility"].message, /no conversion, traffic, ranking, or citation outcome is promised/i);
  assert.doesNotMatch(html, /recommend(?:s|ing)? a (?:full )?rebuild/i);
});

test("CASE 15 — Executive Scorecard cannot contradict a material page state", () => {
  const { states } = run({ truth: { trustProof: truth("finding") } });
  assert.equal(states["trust-credibility"].state, NARRATIVE_STATE.WEAK);
  assert.equal(states["executive-scorecard"].state, NARRATIVE_STATE.WEAK);
  const inconsistent = structuredClone(states);
  inconsistent["executive-scorecard"].state = NARRATIVE_STATE.STRONG;
  assert.throws(() => validateNarrativeStateMap(inconsistent), /contradicts a material weak page/);
});
