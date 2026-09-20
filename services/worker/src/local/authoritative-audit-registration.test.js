import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFsArtifactStore } from "../storage/fs-artifact-store.js";
import {
  createAuthoritativeArtifactBridge,
  readFrozenArtifact,
} from "./authoritative-audit-registration.js";

const AUDIT_ID = "6dca53ed-ae00-484c-bf77-b59c059eef51";
const TENANT_ID = "local-sandbox";
const CLIENT_ID = "www.tbkcreative.com-tbkcreative";

test("authoritative report retrieval renders current bytes without changing frozen source", async () => {
  const root = await mkdtemp(join(tmpdir(), "prysm-authoritative-"));
  const datasetRoot = join(root, "authoritative");
  const storeRoot = join(root, "store");
  await mkdir(join(datasetRoot, "report-v2", "pages"), { recursive: true });
  const frozen = Buffer.from("frozen-authoritative-report", "utf8");
  await writeFile(join(datasetRoot, "report-v2", "pages", "index.html"), frozen);
  const current = Buffer.from("current-governed-render", "utf8");
  let renderCalls = 0;

  const baseStore = createFsArtifactStore({ baseDir: storeRoot });
  const bridge = createAuthoritativeArtifactBridge({
    baseStore,
    datasetRoot,
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    auditId: AUDIT_ID,
    renderCurrentReport: async (identity) => {
      renderCalls += 1;
      assert.equal(identity.datasetRoot, datasetRoot);
      assert.equal(identity.auditId, AUDIT_ID);
      return current;
    },
  });
  const key = `tenants/${TENANT_ID}/clients/${CLIENT_ID}/audits/${AUDIT_ID}/report-v2/pages/index.html`;

  assert.equal(await bridge.exists(key), true);
  assert.deepEqual(await bridge.get(key), current);
  assert.equal(renderCalls, 1);
  assert.deepEqual(await readFile(join(datasetRoot, "report-v2", "pages", "index.html")), frozen);
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

test("authoritative frozen reads reject traversal and sibling-prefix escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "prysm-authoritative-containment-"));
  await mkdir(join(root, "report-v2", "pages"), { recursive: true });
  await writeFile(join(root, "report-v2", "pages", "index.html"), "frozen", "utf8");

  await assert.rejects(
    readFrozenArtifact(root, { category: "report-v2", artifactName: "../../outside.html" }),
    /escaped frozen dataset root/,
  );
  await assert.rejects(
    readFrozenArtifact(root, { category: "report-v2", artifactName: "../../../outside.html" }),
    /escaped frozen dataset root/,
  );
  await assert.rejects(
    readFrozenArtifact(join(tmpdir(), "prysm-authoritative-root"), { category: "report-v2", artifactName: "../../prysm-authoritative-root2/outside.html" }),
    /escaped frozen dataset root/,
  );
});

test("authoritative frozen reads accept nested relative paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "prysm-authoritative-nested-"));
  await mkdir(join(root, "report-v2", "narrative-v2"), { recursive: true });
  const frozen = Buffer.from("nested-frozen", "utf8");
  await writeFile(join(root, "report-v2", "narrative-v2", "orchestration.json"), frozen);

  assert.deepEqual(
    await readFrozenArtifact(root, { category: "report-v2", artifactName: "narrative-v2/orchestration.json" }),
    frozen,
  );
});
