import test from "node:test";
import assert from "node:assert/strict";

import { assertCurrentScoreSet } from "./current-score-set.js";

function currentScoreSet(overrides = {}) {
  return {
    contractVersion: "2.0.0",
    rootCauseRuleId: "VAN-CONV-001",
    decisionHierarchy: {
      hierarchyVersion: "1.0.0",
      provenance: "scoreAudit/action-priority",
      rootCauseRuleId: "VAN-CONV-001",
      orderedFindingIds: ["finding-1", "finding-2"],
      actions: [
        { findingId: "finding-1", ruleId: "VAN-CONV-001" },
        { findingId: "finding-2", ruleId: "VAN-TRUST-002" },
      ],
    },
    ...overrides,
  };
}

test("T1-SCORESET-01: current ScoreSet preserves the governed hierarchy and root-cause binding", () => {
  assert.equal(assertCurrentScoreSet(currentScoreSet()).rootCauseRuleId, "VAN-CONV-001");
});

test("T1-SCORESET-02: missing or mismatched current root-cause identity fails closed", () => {
  assert.throws(
    () => assertCurrentScoreSet(currentScoreSet({ rootCauseRuleId: null })),
    /rootCauseRuleId must match decisionHierarchy/,
  );
  assert.throws(
    () => assertCurrentScoreSet(currentScoreSet({ rootCauseRuleId: "VAN-OTHER-003" })),
    /rootCauseRuleId must match decisionHierarchy/,
  );
});

test("T1-SCORESET-03: array order cannot silently replace the persisted hierarchy", () => {
  const scoreSet = currentScoreSet();
  scoreSet.decisionHierarchy.orderedFindingIds.reverse();
  assert.throws(
    () => assertCurrentScoreSet(scoreSet),
    /action order is inconsistent/,
  );
});
