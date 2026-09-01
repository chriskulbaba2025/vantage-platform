import test from "node:test";
import assert from "node:assert/strict";

import { WRITER_SECTION_FIELDS } from "./judge-contract.js";
import { buildJudgeStructuredOutputSchema } from "./judge-structured-output.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";

test("JUDGE-STRUCT-01: defect sections are constrained to governed Writer fields", () => {
  const schema = buildJudgeStructuredOutputSchema({
    writerInput: {
      auditId: AUDIT_ID,
      referenceIndex: { "finding:F-001": { kind: "finding", path: "findings.0" } },
    },
    passNumber: 2,
    modelId: "judge-structured",
  });

  assert.deepEqual(
    schema.properties.defects.items.properties.section.enum,
    [...WRITER_SECTION_FIELDS],
  );
});
