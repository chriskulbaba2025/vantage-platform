import { test, expect } from "@playwright/test";
import { buildAuditPayload, CURRENT_REPORT_DESIGN_VERSION } from "../../lib/audit-request";

const BASE = {
  targetUrl: "https://version-contract.example.com",
  businessName: "Version Contract Proof",
};

test("PRYSM-CURRENT-REPORT-DEFAULT-01: browser audit payload selects Executive V2 with Snapshot V1 companion", () => {
  const report = buildAuditPayload(BASE).report as Record<string, string>;
  expect(report).toEqual({
    designVersion: "2.0.0",
    narrativeVersion: "1.0.0",
    snapshotVersion: "1.0.0",
  });
  expect(["approved-report", "vantage-phase-1", "karen-leslie", "report-design-v1", "1.0.0"]).not.toContain(report.designVersion);
});

test("PRYSM-CURRENT-REPORT-DEFAULT-02: the new-audit UI contract selects Executive V2", () => {
  expect(CURRENT_REPORT_DESIGN_VERSION).toBe("2.0.0");
});
