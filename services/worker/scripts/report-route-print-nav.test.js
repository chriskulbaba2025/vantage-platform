import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const routePath = resolve("../../app/audits/[auditId]/report/[...path]/route.ts");
const routeSource = readFileSync(routePath, "utf8");

test("reviewer dashboard navigation remains screen-only in printed reports", () => {
  assert.match(routeSource, /filename === "executive\.html"/);
  assert.match(routeSource, /href="\/audits\/\$\{encodeURIComponent\(auditId\)\}" class="no-print"/);
  assert.match(routeSource, /data-prysm-back-dashboard="true" class="no-print"/);
  assert.match(routeSource, /Back to Dashboard/);
});
