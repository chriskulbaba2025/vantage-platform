/**
 * Prysm production bootstrap helpers.
 *
 * Keeps production adapter registration, schema compilation, and lifecycle
 * migrations deterministic and directly testable. No provider calls occur
 * during bootstrap.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execute as onpageExecute, ADAPTER_VERSION as ONPAGE_VERSION } from "../adapters/dataforseo-onpage/dataforseo-onpage-adapter.js";
import { execute as pagespeedExecute } from "../evidence/pagespeed-client.js";
import { execute as serpExecute, ADAPTER_VERSION as SERP_VERSION } from "../adapters/dataforseo-serp/serp-adapter.js";
import { execute as backlinksExecute } from "../adapters/dataforseo-backlinks/backlink-adapter.js";
import { execute as ga4Execute } from "../evidence/ga4-client.js";
import { execute as gscExecute } from "../evidence/gsc-client.js";
import { compileAllSchemas } from "../contracts/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "..", "..", "migrations");
const MIGRATIONS = Object.freeze([
  "001_lifecycle.sql",
  "002_wp11_web_app_integration.sql",
]);

async function executePageSpeedWithProductionConfig(args) {
  const existing = args.auditRequest?.performance || {};
  const pagespeedApiKey = existing.pagespeedApiKey || process.env.GOOGLE_PAGESPEED_API_KEY || process.env.PAGESPEED_API_KEY || "";
  const cruxApiKey = existing.cruxApiKey || process.env.GOOGLE_CRUX_API_KEY || process.env.CRUX_API_KEY || pagespeedApiKey;
  return pagespeedExecute({
    ...args,
    auditRequest: {
      ...args.auditRequest,
      performance: {
        ...existing,
        pagespeedApiKey,
        cruxApiKey,
      },
    },
  });
}

/** Return the exact six governed WP6 production adapters. */
export function createProductionAdapters() {
  return Object.freeze({
    "dataforseo-onpage": Object.freeze({ adapterVersion: ONPAGE_VERSION, execute: onpageExecute }),
    pagespeed: Object.freeze({ adapterVersion: "1.1.0", execute: executePageSpeedWithProductionConfig }),
    "dataforseo-serp": Object.freeze({ adapterVersion: SERP_VERSION, execute: serpExecute }),
    backlinks: Object.freeze({ adapterVersion: "1.0.0", execute: backlinksExecute }),
    ga4: Object.freeze({ adapterVersion: "1.0.0", execute: ga4Execute }),
    gsc: Object.freeze({ adapterVersion: "1.0.0", execute: gscExecute }),
  });
}

/** Compile all frozen contracts and expose the orchestrator validation shape. */
export function createProductionContractValidator() {
  const { ajv } = compileAllSchemas();
  return (schemaId, value) => {
    const validate = ajv.getSchema(schemaId);
    if (!validate) throw new Error(`Required schema not registered: ${schemaId}`);
    const valid = Boolean(validate(value));
    return { valid, errors: validate.errors || [] };
  };
}

/** Apply the idempotent lifecycle migrations from the deployed worker image. */
export async function applyLifecycleMigrations(lifecycleRepo) {
  if (!lifecycleRepo || typeof lifecycleRepo.runMigration !== "function") {
    throw new Error("Lifecycle repository does not support migrations");
  }

  const applied = [];
  for (const filename of MIGRATIONS) {
    const sql = await readFile(resolve(MIGRATIONS_DIR, filename), "utf8");
    if (!sql.trim()) throw new Error(`Lifecycle migration is empty: ${filename}`);
    await lifecycleRepo.runMigration(sql);
    applied.push(filename);
  }
  return Object.freeze(applied);
}

export { MIGRATIONS };

export default {
  createProductionAdapters,
  createProductionContractValidator,
  applyLifecycleMigrations,
};
