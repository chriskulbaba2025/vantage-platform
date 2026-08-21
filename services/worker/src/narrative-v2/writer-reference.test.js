import test from "node:test";
import assert from "node:assert/strict";

import {
  governedStatusForWriterReference,
  resolveWriterReferenceValue,
} from "./writer-reference.js";
import { buildWriterStructuredOutputSchema } from "./writer-structured-output.js";

const AUDIT_ID = "11111111-1111-4111-8111-111111111111";

function productionShapedWriterInput() {
  return {
    auditId: AUDIT_ID,
    findings: [{ findingId: "finding-technical-001", title: "Canonical tag missing" }],
    capabilityContext: {
      capabilities: {
        "technical.indexability": {
          capability: "technical.indexability",
          status: "AVAILABLE",
        },
        "trust.proof": {
          capability: "trust.proof",
          status: "PARTIAL",
        },
      },
    },
    scoreGovernance: {
      sourceDependencies: {
        website: "AVAILABLE",
      },
    },
    referenceIndex: {
      "finding:finding-technical-001": {
        kind: "finding",
        path: "findings.finding-technical-001",
      },
      "capability:technical.indexability": {
        kind: "capability",
        path: "capabilityContext.capabilities.technical.indexability",
      },
      "capability:trust.proof": {
        kind: "capability",
        path: "capabilityContext.capabilities.trust.proof",
      },
      "source:website": {
        kind: "source-status",
        path: "scoreGovernance.sourceDependencies.website",
      },
    },
  };
}

test("WRITER-REF-01: literal capability IDs containing dots resolve without path corruption", () => {
  const input = productionShapedWriterInput();

  assert.equal(
    resolveWriterReferenceValue(input, "capability:technical.indexability").status,
    "AVAILABLE",
  );
  assert.equal(
    governedStatusForWriterReference(input, "capability:trust.proof"),
    "PARTIAL",
  );
});

test("WRITER-REF-02: finding reference IDs resolve the canonical array item by findingId", () => {
  const input = productionShapedWriterInput();
  assert.equal(
    resolveWriterReferenceValue(input, "finding:finding-technical-001").title,
    "Canonical tag missing",
  );
});

test("WRITER-REF-03: structured limitation schema uses production dotted capability statuses instead of fallback", () => {
  const input = productionShapedWriterInput();
  const schema = buildWriterStructuredOutputSchema({
    writerInput: input,
    passNumber: 1,
    modelId: "gpt-5.6-terra",
  });

  const branches = schema.properties.limitations.items.anyOf;
  assert.equal(Array.isArray(branches), true);

  const partial = branches.find((branch) => branch.properties.status.enum[0] === "PARTIAL");
  assert.ok(partial, "PARTIAL limitation branch must exist for capability:trust.proof");
  assert.deepEqual(
    partial.properties.clientExplanation.properties.evidenceRefs.items.enum,
    ["capability:trust.proof"],
  );
});
