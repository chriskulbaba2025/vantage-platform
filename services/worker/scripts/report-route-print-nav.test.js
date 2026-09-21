import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const routePath = resolve("../../app/audits/[auditId]/report/[...path]/route.ts");
const routeSource = readFileSync(routePath, "utf8");

test("reviewer dashboard navigation remains screen-only in printed reports", () => {
  assert.match(routeSource, /<a href="\/" class="no-print" style="display:inline-block;text-decoration:none;font-weight:600;">/);
  assert.match(routeSource, /Back to Dashboard/);
});
