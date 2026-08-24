import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtimeSource = readFileSync(
  new URL(
    "./production-runtime.js",
    import.meta.url,
  ),
  "utf8",
);

test(
  "Track B On-Page whole-source policy is 60 minutes and one attempt",
  () => {
    assert.match(
      runtimeSource,
      /"dataforseo-onpage":\s*config\.onpagePollTimeoutMs\s*\|\|\s*3_600_000/,
    );

    assert.match(
      runtimeSource,
      /source === "dataforseo-serp"\s*\|\|\s*source === "dataforseo-onpage"[\s\S]*?\?\s*1\s*:\s*3/,
    );
  },
);