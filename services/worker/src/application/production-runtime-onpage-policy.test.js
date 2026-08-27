import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadConfig } from "../config.js";

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
      /"dataforseo-onpage":\s*3_600_000/,
    );

    assert.match(
      runtimeSource,
      /source === "dataforseo-serp"\s*\|\|\s*source === "dataforseo-onpage"[\s\S]*?\?\s*1\s*:\s*3/,
    );
  },
);

test(
  "production On-Page configuration defaults to the governed 250-page ceiling",
  () => {
    const previous =
      process.env.VANTAGE_ONPAGE_MAX_PAGES;

    try {
      delete process.env.VANTAGE_ONPAGE_MAX_PAGES;

      const config = loadConfig();

      assert.equal(
        config.onpageMaxPages,
        250,
        "default production crawl ceiling must be 250 pages",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.VANTAGE_ONPAGE_MAX_PAGES;
      } else {
        process.env.VANTAGE_ONPAGE_MAX_PAGES =
          previous;
      }
    }
  },
);

test(
  "production configuration cannot raise On-Page above 250 pages",
  () => {
    const previous =
      process.env.VANTAGE_ONPAGE_MAX_PAGES;

    try {
      process.env.VANTAGE_ONPAGE_MAX_PAGES =
        "100000";

      const config = loadConfig();

      assert.equal(
        config.onpageMaxPages,
        250,
        "oversized production configuration must clamp to 250 pages",
      );
    } finally {
      if (previous === undefined) {
        delete process.env.VANTAGE_ONPAGE_MAX_PAGES;
      } else {
        process.env.VANTAGE_ONPAGE_MAX_PAGES =
          previous;
      }
    }
  },
);