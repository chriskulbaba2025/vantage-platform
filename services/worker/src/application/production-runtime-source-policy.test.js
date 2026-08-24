import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimePath = new URL("./production-runtime.js", import.meta.url);

test(
  "DQV-001: production SERP and On-Page source policies use governed whole-source limits",
  async () => {
    const source = await readFile(runtimePath, "utf8");

    assert.match(
      source,
      /"dataforseo-serp":\s+config\.serpTimeoutMs\s+\|\|\s+1_800_000/,
      "dataforseo-serp must default to a 30-minute whole-source timeout",
    );

    assert.match(
      source,
      /"dataforseo-onpage":\s+config\.onpagePollTimeoutMs\s+\|\|\s+3_600_000/,
      "dataforseo-onpage must default to a 60-minute whole-source timeout",
    );

    assert.match(
      source,
      /maxAttempts:\s+source\s+===\s+"dataforseo-serp"\s+\|\|\s+source\s+===\s+"dataforseo-onpage"\s+\?\s+1\s+:\s+3/,
      "dataforseo-serp and dataforseo-onpage must each use exactly one whole-source attempt",
    );
  },
);