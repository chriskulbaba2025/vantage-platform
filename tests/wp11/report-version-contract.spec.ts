import { test, expect } from "@playwright/test";
import { buildAuditPayload } from "../../lib/audit-request";

const BASE = {
  targetUrl: "https://version-contract.example.com",
  businessName: "Version Contract Proof",
};

test("PRYSM-V2-SELECT-01: Report v2 selection binds design v2 and Narrative v2", () => {
  const payload = buildAuditPayload({
    ...BASE,
    reportDesignVersion: "2.0.0",
  });

  expect(payload.report).toEqual({
    designVersion: "2.0.0",
    narrativeVersion: "2.0.0",
  });
});

test("PRYSM-V2-SELECT-02: default/v1 selection remains fully v1", () => {
  const explicitV1 = buildAuditPayload({
    ...BASE,
    reportDesignVersion: "1.0.0",
  });
  const defaultV1 = buildAuditPayload(BASE);

  expect(explicitV1.report).toEqual({
    designVersion: "1.0.0",
    narrativeVersion: "1.0.0",
  });
  expect(defaultV1.report).toEqual({
    designVersion: "1.0.0",
    narrativeVersion: "1.0.0",
  });
});
