import test from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshotV1CtaUrl, SNAPSHOT_V1_CTA_URL } from "./snapshot-config.js";

test("Snapshot V1 CTA uses the governed default for existing audits without a per-audit override", () => {
  assert.equal(resolveSnapshotV1CtaUrl({ report: { snapshotVersion: "1.0.0" } }, {}), SNAPSHOT_V1_CTA_URL);
});

test("Snapshot V1 CTA preserves a valid governed per-audit override", () => {
  assert.equal(resolveSnapshotV1CtaUrl({ report: { snapshotCtaUrl: "https://calendly.com/example/slot" } }, {}), "https://calendly.com/example/slot");
  assert.equal(resolveSnapshotV1CtaUrl({ report: { snapshotCtaUrl: "javascript:alert(1)" } }, {}), "");
});
