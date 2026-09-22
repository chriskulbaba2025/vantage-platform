import test from "node:test";
import assert from "node:assert/strict";

import {
  clientEvidenceStatus,
  clientSafeCopy,
  projectDimensionRows,
  projectEvidenceConfidence,
  projectEvidenceCoverage,
  projectImplementationContext,
  projectJourneyStages,
} from "./client-presentation.js";

test("client evidence states stay distinct and do not collapse unknown into failure", () => {
  assert.deepEqual(
    ["AVAILABLE", "PARTIAL", "UNAVAILABLE", "NOT_COLLECTED", "NOT_CONNECTED", "FAILED", "BLOCKED", "NOT_APPLICABLE", "UNKNOWN"].map(clientEvidenceStatus),
    ["Reviewed", "Partly reviewed", "Not available", "Not collected", "Not connected", "Could not be reviewed", "Could not be reviewed", "Not applicable", "Not recorded"],
  );
});

test("evidence strip uses recorded statuses and only directly recorded counts", () => {
  const rows = projectEvidenceCoverage({
    evidence: {
      site: { sourceStatus: "PARTIAL", coverage: { requested: 5, completed: 3 } },
      performance: { sourceStatus: "AVAILABLE", coverage: { requested: 2, completed: 2 } },
      ga4: { sourceStatus: "NOT_CONNECTED" },
    },
    recoveredAuditData: { conversionValidation: { status: "FAILED", pageCount: 0 } },
  });

  assert.deepEqual(rows.map(({ label, status, coverage }) => ({ label, status, coverage })), [
    { label: "Website", status: "Partly reviewed", coverage: "3 of 5 pages" },
    { label: "Browser path", status: "Could not be reviewed", coverage: undefined },
    { label: "Performance", status: "Reviewed", coverage: "2 of 2 checks" },
    { label: "Analytics", status: "Not connected", coverage: undefined },
  ]);
  assert.equal(projectEvidenceCoverage({ evidence: { site: { sourceStatus: "AVAILABLE", coverage: { requested: 5, completed: 8 } } } })[0].coverage, undefined);
});

test("confidence uses the existing score band and leaves missing band unestablished", () => {
  assert.equal(projectEvidenceConfidence({ bands: { evidenceConfidence: "High" }, evidenceConfidenceScore: 91 }), "High");
  assert.equal(projectEvidenceConfidence({ bands: { evidenceConfidence: "Moderate" } }), "Moderate");
  assert.equal(projectEvidenceConfidence({ bands: { evidenceConfidence: "Directional" } }), "Limited");
  assert.equal(projectEvidenceConfidence({ bands: {} }), "Not established");
});

test("dimension values are exact; missing and malformed values never become zero", () => {
  const result = projectDimensionRows([
    { id: "content", label: "Offer & Content", score: 62, capabilities: [{ key: "content.body", status: "PARTIAL" }] },
    { id: "trust", label: "Trust & Proof", score: null },
    { id: "technical", label: "Technical Health", score: 101 },
  ]);

  assert.equal(result[0].score, 62);
  assert.equal(result[0].state, "Adequate");
  assert.equal(result[0].evidence[0].status, "Partly reviewed");
  assert.equal(result[1].score, null);
  assert.equal(result[1].state, "Not assessed");
  assert.equal(result[2].score, null);
  assert.equal(result[2].state, "Not assessed");
});

test("journey stages need an accepted evidence-linked buyer relationship", () => {
  const stages = projectJourneyStages([
    {
      canonicalProblemId: "A01",
      frictionState: "FRICTION",
      conversionAction: "review search entry",
      evidence: [{ sourceStatus: "AVAILABLE" }],
    },
    {
      canonicalProblemId: "C01",
      frictionState: "FRICTION",
      conversionAction: "continue decision",
      evidence: [{ sourceStatus: "AVAILABLE" }],
    },
    {
      canonicalProblemId: "F02",
      frictionState: "FRICTION",
      evidence: [{ sourceStatus: "AVAILABLE" }],
    },
    {
      canonicalProblemId: "J04",
      frictionState: "FRICTION",
      conversionAction: "continue decision",
      evidence: [{ sourceStatus: "AVAILABLE" }],
    },
    {
      canonicalProblemId: "D01",
      frictionState: "NOT_ENOUGH_EVIDENCE",
      buyerDecisionQuestion: "Which option fits?",
      evidence: [{ sourceStatus: "PARTIAL" }],
    },
  ]);

  assert.deepEqual(stages.map(({ stage, status }) => ({ stage, status })), [
    { stage: "Awareness", status: "Needs attention" },
    { stage: "Consideration", status: "Needs attention" },
    { stage: "Decision", status: "Not established" },
    { stage: "Action", status: "Not established" },
  ]);
  assert.match(stages[1].context, /Page purpose is unclear/);
  assert.match(stages[2].context, /No accepted/);
});

test("journey clustering fails closed when member stages do not agree", () => {
  const [consideration] = projectJourneyStages([{
    canonicalProblemId: "C01",
    canonicalProblemIds: ["C01", "F02"],
    frictionState: "FRICTION",
    buyerDecisionQuestion: "What should happen next?",
    evidence: [{ sourceStatus: "AVAILABLE" }],
  }]).filter((item) => item.stage === "Consideration");
  const action = projectJourneyStages([{
    canonicalProblemId: "C01",
    canonicalProblemIds: ["C01", "F02"],
    frictionState: "FRICTION",
    buyerDecisionQuestion: "What should happen next?",
    evidence: [{ sourceStatus: "AVAILABLE" }],
  }]).find((item) => item.stage === "Action");

  assert.equal(consideration.status, "Not established");
  assert.equal(action.status, "Not established");
});

test("implementation context fails closed for unknown platforms and maps only controlled helper requirements", () => {
  assert.deepEqual(projectImplementationContext({ capabilityRequired: ["FRONT_END_DEVELOPMENT"] }, "Unknown"), {
    label: "Needs checking",
    detail: "We need to confirm what the site allows before choosing the final fix.",
  });
  assert.match(projectImplementationContext({ capabilityRequired: ["CMS_CONFIGURATION"] }, "WordPress").label, /site admin or CMS access/);
  assert.match(projectImplementationContext({ capabilityRequired: ["FRONT_END_DEVELOPMENT"] }, "Shopify").label, /web developer/);
  assert.match(projectImplementationContext({ capabilityRequired: ["HOSTING_PLATFORM_CONFIGURATION"] }, "Custom").label, /hosting or platform support/);
  assert.match(projectImplementationContext({ capabilityRequired: ["FRONT_END_DEVELOPMENT", "HOSTING_PLATFORM_CONFIGURATION"], dependencies: [{ targetIssueId: "SOL-2" }] }, "Custom").detail, /prerequisite is also recorded/);
  assert.equal(projectImplementationContext({ capabilityRequired: ["COPY_CONTENT"] }, "WordPress").label, "Needs checking");
});

test("client-safe copy withholds rule IDs and raw error text", () => {
  for (const text of [
    "CrUX PHONE failed (403)",
    "Screenshot persistence failed: runId is required",
    "TypeError: Cannot read properties of undefined",
    "Exception in provider adapter",
    "Problem J04 was unavailable",
  ]) {
    assert.equal(clientSafeCopy(text), "Technical details for this check are not shown in this client report.");
  }
  assert.equal(clientSafeCopy("We reviewed three pages, but this does not establish whole-site coverage."), "We reviewed three pages, but this does not establish whole-site coverage.");
});
