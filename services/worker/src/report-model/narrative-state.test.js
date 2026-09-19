import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveNarrativeStates,
  validateNarrativeStateMap,
  NARRATIVE_STATE,
  EVIDENCE_SUFFICIENCY,
} from "./narrative-state.js";

const truth = (state = "assessed", refs = ["fixture:evidence"], scope = "two reviewed pages") => ({
  state,
  scope,
  observation: "Fixture observation",
  clientConclusion: "Fixture conclusion",
  qualifier: state === "partial" ? "Bounded to the reviewed scope." : null,
  prohibitedUpgrades: ["site-wide certainty"],
  evidenceRefs: refs,
});

function model(overrides = {}) {
  const allTruth = {
    offerClarity: truth(),
    ctaClarity: truth(),
    conversionPathClarity: truth(),
    buyerQuestionCoverage: truth(),
    trustProof: truth(),
    performanceReadiness: truth("partial"),
    indexability: truth(),
    evidenceScope: truth(),
  };
  return {
    scores: { conversionReadiness: 80 },
    findings: [],
    sourceStatus: { competitors: "AVAILABLE" },
    capabilityEvidence: { capabilities: { "content.body": { status: "AVAILABLE" } } },
    competitors: { comparisons: [{ name: "Example competitor", status: "AVAILABLE" }], opportunities: { gaps: [] } },
    crossReportInterpretation: {
      version: "2.0.0",
      contract: "CLIENT_TRUTH",
      constructs: {
        offerClarity: "fixture", ctaClarity: "fixture", conversionPathClarity: "fixture",
        trustProof: "fixture", mobileUsability: "fixture", indexability: "fixture",
      },
      truth: { ...allTruth, ...(overrides.truth || {}) },
    },
    ...overrides,
  };
}

function freshMap() {
  return structuredClone(deriveNarrativeStates(model()));
}

test("the producer emits exactly four narrative states and four sufficiency states", () => {
  const states = deriveNarrativeStates(model());
  assert.deepEqual(Object.values(NARRATIVE_STATE).sort(), ["INSUFFICIENT_EVIDENCE", "MIDDLE", "STRONG", "WEAK"].sort());
  assert.deepEqual(Object.values(EVIDENCE_SUFFICIENCY).sort(), ["BOUNDED_PARTIAL", "INSUFFICIENT", "NOT_APPLICABLE", "SUFFICIENT"].sort());
  assert.equal(Object.keys(states).length, 7);
  for (const record of Object.values(states)) {
    assert.ok(Object.values(NARRATIVE_STATE).includes(record.state));
    assert.ok(Object.values(EVIDENCE_SUFFICIENCY).includes(record.evidenceSufficiency));
  }
});

test("missing evidence cannot cause STRONG or WEAK", () => {
  const states = deriveNarrativeStates(model({ truth: { trustProof: truth("not assessed") } }));
  assert.equal(states["trust-credibility"].state, NARRATIVE_STATE.INSUFFICIENT_EVIDENCE);
  assert.equal(states["trust-credibility"].evidenceSufficiency, EVIDENCE_SUFFICIENCY.INSUFFICIENT);
});

test("score alone cannot select narrative state", () => {
  const low = deriveNarrativeStates(model({ scores: { conversionReadiness: 1 } }));
  const high = deriveNarrativeStates(model({ scores: { conversionReadiness: 99 } }));
  assert.equal(low["content-opportunities"].state, high["content-opportunities"].state);
});

test("finding count and severity alone cannot select narrative state", () => {
  const base = deriveNarrativeStates(model())["priority-fixes"].state;
  const changed = deriveNarrativeStates(model({ findings: [{ severity: "High" }, { severity: "High" }] }))["priority-fixes"].state;
  assert.equal(changed, base);
});

test("partial evidence remains bounded and cannot render as complete coverage", () => {
  const states = deriveNarrativeStates(model({ truth: { trustProof: truth("partial") } }));
  assert.equal(states["trust-credibility"].evidenceSufficiency, EVIDENCE_SUFFICIENCY.BOUNDED_PARTIAL);
  assert.equal(states["trust-credibility"].state, NARRATIVE_STATE.MIDDLE);
  assert.match(states["trust-credibility"].limitations.join(" "), /Bounded|reviewed scope/i);
});

test("bounded sample stays traceable to its reviewed scope", () => {
  const states = deriveNarrativeStates(model({ truth: { buyerQuestionCoverage: truth("partial", ["fixture:sample"], "3 of 10 requested pages") } }));
  assert.equal(states["content-opportunities"].reviewedScope, "3 of 10 requested pages");
  assert.deepEqual(states["content-opportunities"].evidenceRefs, ["fixture:sample"]);
});

test("common cause remains bounded diagnostic guidance", () => {
  const states = deriveNarrativeStates(model({ findings: [{ scoreBearing: true, actionable: true, confidence: "supported", evidence: [{ field: "fixture:observed" }] }] }));
  assert.equal(states["priority-fixes"].state, NARRATIVE_STATE.MIDDLE);
  assert.match(states["priority-fixes"].boundedAction, /diagnostic|Check these first/i);
});

test("competitor behavior alone cannot create a client defect or recommendation", () => {
  const states = deriveNarrativeStates(model({ competitors: { comparisons: [{ name: "Stronger competitor", status: "AVAILABLE", offerClarity: "Strong" }], opportunities: { gaps: [{ observedCompetitorCoverage: ["More proof"] }] } } }));
  assert.notEqual(states["competitor-comparison"].state, NARRATIVE_STATE.WEAK);
  assert.match(states["competitor-comparison"].boundedAction, /client's own established evidence/i);
});

test("search demand alone cannot create a content defect", () => {
  const states = deriveNarrativeStates(model({ contentIdeas: { leading: [{ query: "high demand" }] } }));
  assert.equal(states["content-opportunities"].state, NARRATIVE_STATE.STRONG);
});

test("lab evidence retains its partial boundary and does not become field performance", () => {
  const states = deriveNarrativeStates(model());
  assert.equal(states["supporting-detail"].evidenceSufficiency, EVIDENCE_SUFFICIENCY.SUFFICIENT);
  assert.deepEqual(states["supporting-detail"].prohibitedUpgrades, ["site-wide certainty"]);
});

test("Supporting Detail insufficiency fails closed across the complete map", () => {
  const states = deriveNarrativeStates(model({ truth: { evidenceScope: truth("not assessed") } }));
  for (const record of Object.values(states)) assert.equal(record.state, NARRATIVE_STATE.INSUFFICIENT_EVIDENCE);
});

test("Priority Fixes does not give a confident remedy for an unverified cause", () => {
  const states = deriveNarrativeStates(model({ findings: [{ scoreBearing: true, actionable: true, confidence: "directional", evidence: [{ field: "fixture:signal" }] }] }));
  assert.equal(states["priority-fixes"].recommendationCertainty, "BOUNDED");
  assert.match(states["priority-fixes"].boundedAction, /diagnostic|Check these first/i);
});

test("WEAK never authorizes rebuild", () => {
  const states = deriveNarrativeStates(model({ truth: { trustProof: truth("finding") } }));
  assert.equal(states["trust-credibility"].state, NARRATIVE_STATE.WEAK);
  for (const record of Object.values(states)) assert.equal(record.rebuildAuthorization.allowed, false);
});

test("Executive Scorecard cannot contradict a material weak supporting page", () => {
  const states = deriveNarrativeStates(model({ truth: { trustProof: truth("finding") } }));
  assert.notEqual(states["executive-scorecard"].state, NARRATIVE_STATE.STRONG);
  assert.equal(states["executive-scorecard"].state, NARRATIVE_STATE.WEAK);
});

test("unsupported state/status input fails safely", () => {
  assert.throws(() => deriveNarrativeStates(model({ truth: { trustProof: truth("invented") } })), /Unsupported Client Truth state/);
  assert.throws(() => deriveNarrativeStates(model({ capabilityEvidence: { capabilities: { "content.body": { status: "MYSTERY" } } } })), /Unsupported evidence status/);
});

test("validator rejects untraceable conclusions and certainty upgrades", () => {
  const untraceable = freshMap();
  untraceable["trust-credibility"].evidenceRefs = [];
  assert.throws(() => validateNarrativeStateMap(untraceable), /Untraceable/);
  const upgraded = freshMap();
  upgraded["trust-credibility"].evidenceSufficiency = EVIDENCE_SUFFICIENCY.BOUNDED_PARTIAL;
  upgraded["trust-credibility"].recommendationCertainty = "ESTABLISHED";
  assert.throws(() => validateNarrativeStateMap(upgraded), /certainty/);
});

test("state derivation is separated from rebuild authorization", () => {
  const weak = deriveNarrativeStates(model({ truth: { conversionPathClarity: truth("finding") } }));
  const same = deriveNarrativeStates(model({ scores: { conversionReadiness: 1 }, truth: { conversionPathClarity: truth("finding") } }));
  assert.equal(weak["conversion-journey"].state, NARRATIVE_STATE.WEAK);
  assert.equal(same["conversion-journey"].state, NARRATIVE_STATE.WEAK);
  assert.equal(weak["conversion-journey"].rebuildAuthorization.allowed, false);
});
