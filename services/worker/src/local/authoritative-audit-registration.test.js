import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsArtifactStore } from "../storage/fs-artifact-store.js";
import {
  createAuthoritativeArtifactBridge,
} from "./authoritative-audit-registration.js";

const AUDIT_ID = "6dca53ed-ae00-484c-bf77-b59c059eef51";
const TENANT_ID = "local-sandbox";
const CLIENT_ID = "www.tbkcreative.com-tbkcreative";

test("authoritative bridge reads frozen bytes and rejects target writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "prysm-authoritative-"));
  const datasetRoot = join(root, "authoritative");
  const storeRoot = join(root, "store");
  await mkdir(join(datasetRoot, "report-v2", "pages"), { recursive: true });
  const frozen = Buffer.from("frozen-authoritative-report", "utf8");
  await writeFile(join(datasetRoot, "report-v2", "pages", "index.html"), frozen);

  const baseStore = createFsArtifactStore({ baseDir: storeRoot });
  const bridge = createAuthoritativeArtifactBridge({
    baseStore,
    datasetRoot,
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    auditId: AUDIT_ID,
  });
  const key = `tenants/${TENANT_ID}/clients/${CLIENT_ID}/audits/${AUDIT_ID}/report-v2/pages/index.html`;

  assert.equal(await bridge.exists(key), true);
  assert.deepEqual(await bridge.get(key), frozen);
  await assert.rejects(
    bridge.put({
      bytes: Buffer.from("mutable substitute"),
      contentType: "text/html",
      scope: { tenantId: TENANT_ID, clientId: CLIENT_ID, auditId: AUDIT_ID, category: "report-v2", artifactName: "pages/index.html" },
    }),
    /read-only/,
  );
  await assert.rejects(readFile(join(storeRoot, "tenants", TENANT_ID, "clients", CLIENT_ID, "audits", AUDIT_ID, "report-v2", "pages", "index.html")));
});
