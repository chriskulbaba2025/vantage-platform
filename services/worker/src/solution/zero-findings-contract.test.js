import test from "node:test";
import assert from "node:assert/strict";
import { buildSolutionAuthorityRecords, buildCanonicalSolutionSet } from "./solution-authority-provider.js";
import { buildSolutionDirectiveInput } from "./solution-directive-authority.js";
import { generateCanonicalSolutions } from "./solution-generator.js";
import { buildWriterStructuredOutputSchema } from "../narrative-v2/writer-structured-output.js";

function scoreSet(overrides = {}) {
  return {
    rootCauseRuleId: null,
    decisionHierarchy: {
      hierarchyVersion: "1.0.0",
      provenance: "scoreAudit/action-priority",
      rootCauseRuleId: null,
      orderedFindingIds: [],
      actions: [],
    },
    ...overrides,
  };
}

test("valid zero findings produces no authority records or solutions", () => {
  const input = { findings: [], scoreSet: scoreSet(), decisionEvidence: {} };
  assert.deepEqual(buildSolutionAuthorityRecords(input), {});
  const directives = buildSolutionDirectiveInput({ ...input, authorityRecords: {}, pageRegistry: new Set() });
  assert.deepEqual(directives.findings, []);
  assert.deepEqual(directives.decisionHierarchy.orderedFindingIds, []);
  assert.deepEqual(generateCanonicalSolutions(directives), { records: [], sequence: [], activeSequence: [] });
  assert.deepEqual(buildCanonicalSolutionSet(input), { records: [], sequence: [], activeSequence: [] });
});

test("empty findings with a non-empty hierarchy fails closed", () => {
  const invalid = scoreSet({
    decisionHierarchy: {
      hierarchyVersion: "1.0.0",
      provenance: "scoreAudit/action-priority",
      rootCauseRuleId: "VAN-TEST-001",
      orderedFindingIds: ["F-1"],
      actions: [{ findingId: "F-1", rank: 1, ruleId: "VAN-TEST-001" }],
    },
    rootCauseRuleId: "VAN-TEST-001",
  });
  assert.throws(() => buildSolutionAuthorityRecords({ findings: [], scoreSet: invalid, decisionEvidence: {} }), /Empty findings/);
  assert.throws(
    () => generateCanonicalSolutions({ findings: [], decisionHierarchy: invalid.decisionHierarchy }),
    (error) => error?.errors?.some((item) => /Empty findings/.test(item.message)),
  );
});

test("missing, null, and wrong-type findings remain invalid", () => {
  const input = { scoreSet: scoreSet(), decisionEvidence: {} };
  assert.throws(() => buildSolutionAuthorityRecords(input), /findings must be an array/);
  assert.throws(() => buildSolutionAuthorityRecords({ ...input, findings: null }), /findings must be an array/);
  assert.throws(() => buildSolutionAuthorityRecords({ ...input, findings: [{}] }), /unique findingId/);
});

test("Writer contract permits empty strengths/action plan only for zero governed findings", () => {
  const zeroWriterInput = {
    auditId: "00000000-0000-4000-8000-000000000001",
    referenceIndex: { "score:readinessStatus": { kind: "score", path: "score.readinessStatus" } },
    deterministicAnalysis: { conversionInfluence: { orderedFindingIds: [], byFindingId: {} } },
  };
  const zeroSchema = buildWriterStructuredOutputSchema({ writerInput: zeroWriterInput, passNumber: 1, modelId: "test-model" });
  assert.equal(zeroSchema.properties.strengths.minItems, 0);
  assert.equal(zeroSchema.properties.actionPlan.minItems, 0);

  const normalSchema = buildWriterStructuredOutputSchema({
    writerInput: { ...zeroWriterInput, deterministicAnalysis: { conversionInfluence: { orderedFindingIds: ["F-1"], byFindingId: { "F-1": { rank: 1, effort: "M" } } } } },
    passNumber: 1,
    modelId: "test-model",
  });
  assert.equal(normalSchema.properties.strengths.minItems, 1);
  assert.equal(normalSchema.properties.actionPlan.minItems, 1);
});
