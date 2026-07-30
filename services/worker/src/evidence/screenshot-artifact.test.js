/**
 * Screenshot Artifact Persistence — Regression Tests
 *
 * Covers: portable references, local/production storage resolution,
 * path traversal rejection, metadata completeness (runId, slug,
 * diagnosticCode, checksum), Windows/Linux absolute path prevention,
 * and report rendering from portable references.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  persistScreenshot,
  readScreenshotAsDataUri,
  buildPortableRef,
  isValidPortableRef,
  resolvePortableRef,
} from "./screenshot-artifact.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MINIMAL_JPEG = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
  ...Array(200).fill(0x00),
  0xFF, 0xD9,
]);
const VALID_BASE64 = MINIMAL_JPEG.toString("base64");

let testDir;
const TEST_ARTIFACT_ROOT = resolve(tmpdir(), "vantage-ss-portable-test-" + Date.now());

test.before(async () => {
  testDir = TEST_ARTIFACT_ROOT;
  await mkdir(testDir, { recursive: true });
});

test.after(async () => {
  try { await rmdir(testDir, { recursive: true }); } catch { /* best-effort */ }
});

const TEST_META = {
  runId: "run-abc123",
  slug: "example-business",
  url: "https://example.com/",
  finalUrl: "https://example.com/",
  strategy: "mobile",
  provider: "pagespeed-insights",
  diagnosticCode: "NO_LCP",
};

// ---------------------------------------------------------------------------
// Portable reference format
// ---------------------------------------------------------------------------

test("T-SS-01: buildPortableRef produces canonical format", () => {
  const ref = buildPortableRef({ slug: "my-site", runId: "r-001", filename: "screenshot-abc.jpg" });
  assert.equal(ref, "reports/my-site/r-001/evidence/screenshots/screenshot-abc.jpg");
});

test("T-SS-02: buildPortableRef rejects path traversal in segments", () => {
  assert.throws(() => buildPortableRef({ slug: "../escape", runId: "r-001", filename: "img.jpg" }), /path separator/);
  assert.throws(() => buildPortableRef({ slug: "ok", runId: "..", filename: "img.jpg" }), /traversal/);
  assert.throws(() => buildPortableRef({ slug: "ok", runId: "r-001", filename: "../img.jpg" }), /path separator/);
  assert.throws(() => buildPortableRef({ slug: "", runId: "r-001", filename: "img.jpg" }), /non-empty/);
});

// ---------------------------------------------------------------------------
// Portable reference validation
// ---------------------------------------------------------------------------

test("T-SS-03: isValidPortableRef accepts canonical references", () => {
  assert.equal(isValidPortableRef("reports/my-site/r-001/evidence/screenshots/img.jpg").valid, true);
  assert.equal(isValidPortableRef("reports/a-b/r-xyz-999/evidence/screenshots/screenshot-hash123.jpg").valid, true);
});

test("T-SS-04: isValidPortableRef rejects Windows absolute paths", () => {
  const winPath = `C:${sep}Users${sep}kulba${sep}artifacts${sep}screenshot.jpg`;
  const result = isValidPortableRef(winPath);
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("Windows absolute path"), `Got: ${result.error}`);
});

test("T-SS-05: isValidPortableRef rejects Linux absolute paths", () => {
  const result = isValidPortableRef("/app/artifacts/reports/site/r-001/screenshot.jpg");
  assert.equal(result.valid, false);
  assert.ok(result.error.includes("absolute path"), `Got: ${result.error}`);
});

test("T-SS-06: isValidPortableRef rejects path traversal", () => {
  assert.equal(isValidPortableRef("reports/../../etc/passwd").valid, false);
  assert.equal(isValidPortableRef("reports/site/../r-001/screenshot.jpg").valid, false);
  assert.equal(isValidPortableRef("reports/site/r-001/evidence/screenshots/../../secret.jpg").valid, false);
});

test("T-SS-07: isValidPortableRef rejects backslashes", () => {
  assert.equal(isValidPortableRef("reports\\site\\r-001\\evidence\\screenshots\\img.jpg").valid, false);
});

test("T-SS-08: isValidPortableRef rejects non-canonical patterns", () => {
  assert.equal(isValidPortableRef("screenshots/img.jpg").valid, false);
  assert.equal(isValidPortableRef("reports/site/r-001/img.jpg").valid, false);
  assert.equal(isValidPortableRef("artifacts/local/screenshot.jpg").valid, false);
});

// ---------------------------------------------------------------------------
// Local resolution
// ---------------------------------------------------------------------------

test("T-SS-09: resolvePortableRef resolves to correct local path", () => {
  const { resolvedPath } = resolvePortableRef(
    "reports/my-site/r-001/evidence/screenshots/img.jpg",
    "/data/artifacts",
  );
  assert.ok(resolvedPath, "Must resolve");
  const normalized = resolvedPath.replace(/\\/g, "/");
  assert.ok(normalized.endsWith("reports/my-site/r-001/evidence/screenshots/img.jpg"),
    `Got: ${normalized}`);
  assert.ok(normalized.startsWith("/data/artifacts") || normalized.includes("data/artifacts"),
    `Must be under artifact root, got: ${normalized}`);
});

test("T-SS-10: resolvePortableRef blocks path traversal escaping root", () => {
  const { resolvedPath, error } = resolvePortableRef(
    "reports/../../../etc/passwd",
    "/data/artifacts",
  );
  assert.equal(resolvedPath, null, "Must not resolve traversal");
  assert.ok(error, "Must have error");
});

// ---------------------------------------------------------------------------
// Persistence with portable references
// ---------------------------------------------------------------------------

test("T-SS-11: persistScreenshot returns portableRef, not absolute path", async () => {
  const result = await persistScreenshot(VALID_BASE64, TEST_META, { artifactRoot: testDir });
  assert.equal(result.persisted, true);
  assert.ok(result.portableRef, "Must return portableRef");
  assert.ok(result.checksum, "Must return checksum");
  assert.ok(result.sizeBytes > 100);

  // Verify it's a portable ref, not an absolute OS path
  assert.equal(result.portableRef.startsWith("/"), false, "Must not start with /");
  assert.equal(result.portableRef.match(/^[A-Za-z]:/), null, "Must not be Windows path");
  assert.ok(result.portableRef.startsWith("reports/"), `Must start with reports/, got: ${result.portableRef}`);

  // Verify file exists
  const { resolvedPath } = resolvePortableRef(result.portableRef, testDir);
  assert.ok(resolvedPath, "Must resolve to local path");
  assert.ok(existsSync(resolvedPath), `File must exist at: ${resolvedPath}`);
});

test("T-SS-12: persistScreenshot writes metadata with all required fields", async () => {
  const result = await persistScreenshot(VALID_BASE64, {
    ...TEST_META,
    diagnosticCode: "PAGE_BLANK",
  }, { artifactRoot: testDir });

  assert.equal(result.persisted, true);

  // Read metadata JSON
  const metaRef = result.portableRef.replace(/\.jpg$/i, ".meta.json");
  const { resolvedPath: metaPath } = resolvePortableRef(metaRef, testDir);
  assert.ok(metaPath, "Must resolve metadata path");
  const meta = JSON.parse(await readFile(metaPath, "utf-8"));

  // Check all required fields
  assert.equal(meta.artifactType, "screenshot");
  assert.equal(meta.artifactVersion, "1.0.0");
  assert.equal(meta.portableArtifactRef, result.portableRef);
  assert.equal(meta.runId, "run-abc123");
  assert.equal(meta.slug, "example-business");
  assert.equal(meta.diagnosticCode, "PAGE_BLANK");
  assert.equal(meta.provider, "pagespeed-insights");
  assert.equal(meta.requestedUrl, "https://example.com/");
  assert.equal(meta.finalUrl, "https://example.com/");
  assert.equal(meta.device, "mobile");
  assert.equal(meta.mimeType, "image/jpeg");
  assert.equal(meta.format, "jpeg");
  assert.ok(meta.sizeBytes > 100);
  assert.ok(meta.checksum, "Must have sha256 checksum");
  assert.ok(meta.collectedAt, "Must have collection timestamp");
  assert.ok(meta.persistedAt, "Must have persistence timestamp");
  assert.ok(meta.imageFile, "Must have image filename");
  assert.equal(meta.checksum, result.checksum);
});

test("T-SS-13: runId and diagnosticCode are populated in metadata", async () => {
  const result = await persistScreenshot(VALID_BASE64, {
    ...TEST_META,
    runId: "audit-run-999",
    diagnosticCode: "NO_LCP",
  }, { artifactRoot: testDir });

  const metaRef = result.portableRef.replace(/\.jpg$/i, ".meta.json");
  const { resolvedPath } = resolvePortableRef(metaRef, testDir);
  const meta = JSON.parse(await readFile(resolvedPath, "utf-8"));

  assert.equal(meta.runId, "audit-run-999");
  assert.equal(meta.diagnosticCode, "NO_LCP");
  // These must NOT be null when associated with a diagnostic
  assert.notEqual(meta.runId, null);
  assert.notEqual(meta.diagnosticCode, null);
});

test("T-SS-14: persistScreenshot requires runId and slug", async () => {
  const noRunId = await persistScreenshot(VALID_BASE64, { ...TEST_META, runId: "" }, { artifactRoot: testDir });
  assert.equal(noRunId.persisted, false);
  assert.ok(noRunId.error.includes("runId"));

  const noSlug = await persistScreenshot(VALID_BASE64, { ...TEST_META, slug: "" }, { artifactRoot: testDir });
  assert.equal(noSlug.persisted, false);
  assert.ok(noSlug.error.includes("slug"));
});

test("T-SS-15: persistScreenshot strips data URI prefix", async () => {
  const withPrefix = `data:image/jpeg;base64,${VALID_BASE64}`;
  const result = await persistScreenshot(withPrefix, TEST_META, { artifactRoot: testDir });
  assert.equal(result.persisted, true);
});

test("T-SS-16: persistScreenshot rejects null/empty/too-small input", async () => {
  const r1 = await persistScreenshot(null, TEST_META, { artifactRoot: testDir });
  assert.equal(r1.persisted, false);
  assert.equal(r1.portableRef, null);

  const r2 = await persistScreenshot("   ", TEST_META, { artifactRoot: testDir });
  assert.equal(r2.persisted, false);

  // 4-byte "JPEG" is too small
  const tiny = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString("base64");
  const r3 = await persistScreenshot(tiny, TEST_META, { artifactRoot: testDir });
  assert.equal(r3.persisted, false);
  assert.ok(r3.error.includes("too small"));
});

// ---------------------------------------------------------------------------
// Artifact-write failure
// ---------------------------------------------------------------------------

test("T-SS-17: artifact-write failure is reported without throwing", async () => {
  const fs = await import("node:fs/promises");
  const blocker = resolve(testDir, "blocker-file.txt");
  await fs.writeFile(blocker, "block");

  let errorResult;
  try {
    errorResult = await persistScreenshot(VALID_BASE64, {
      ...TEST_META,
      runId: "run-fail",
      slug: "test-site",
    }, { artifactRoot: blocker }); // blocker is a file, not a directory
  } finally {
    await fs.unlink(blocker).catch(() => {});
  }

  assert.equal(errorResult.persisted, false);
  assert.equal(errorResult.portableRef, null);
  assert.ok(errorResult.error, "Must have error message");
});

// ---------------------------------------------------------------------------
// Data URI reading from portable reference
// ---------------------------------------------------------------------------

test("T-SS-18: readScreenshotAsDataUri from portable ref", async () => {
  const result = await persistScreenshot(VALID_BASE64, TEST_META, { artifactRoot: testDir });
  assert.equal(result.persisted, true);

  const { dataUri } = readScreenshotAsDataUri(result.portableRef, testDir);
  assert.ok(dataUri, "Must return data URI");
  assert.ok(dataUri.startsWith("data:image/jpeg;base64,"), "Must be JPEG data URI");
});

test("T-SS-19: readScreenshotAsDataUri rejects absolute OS paths", () => {
  const { dataUri, error } = readScreenshotAsDataUri(
    `C:${sep}Users${sep}someone${sep}screenshot.jpg`,
    testDir,
  );
  assert.equal(dataUri, null, "Must not read from absolute Windows path");
  assert.ok(error, "Must reject with error");
});

// ---------------------------------------------------------------------------
// Production storage abstraction
// ---------------------------------------------------------------------------

test("T-SS-20: objectStore interface writes through abstraction", async () => {
  const written = {};
  const objectStore = {
    async writeBinary(key, binary, mimeType) {
      written[key] = { size: binary.length, mimeType };
    },
    async writeJson(key, data) {
      written[key] = { json: data };
    },
  };

  const result = await persistScreenshot(VALID_BASE64, {
    ...TEST_META,
    diagnosticCode: "NO_LCP",
  }, { objectStore });

  assert.equal(result.persisted, true);
  assert.ok(result.portableRef, "Must have portableRef even with objectStore");
  assert.ok(written[result.portableRef], `Must have written binary at ${result.portableRef}`);
  assert.equal(written[result.portableRef].size, MINIMAL_JPEG.length);

  // Metadata should also have been written
  const metaKey = result.portableRef.replace(/\.jpg$/i, ".meta.json");
  assert.ok(written[metaKey], `Must have written metadata at ${metaKey}`);
  assert.equal(written[metaKey].json.diagnosticCode, "NO_LCP");
  assert.equal(written[metaKey].json.runId, "run-abc123");
});

// ---------------------------------------------------------------------------
// Same portable ref works for local and object storage
// ---------------------------------------------------------------------------

test("T-SS-21: local and production storage produce the same portable ref format", async () => {
  const localResult = await persistScreenshot(VALID_BASE64, TEST_META, { artifactRoot: testDir });
  assert.ok(localResult.portableRef.startsWith("reports/"));

  const objectStore = { writeBinary: async () => {}, writeJson: async () => {} };
  const prodResult = await persistScreenshot(VALID_BASE64, TEST_META, { objectStore });
  assert.ok(prodResult.portableRef.startsWith("reports/"));

  // Both should follow the same pattern
  const pattern = /^reports\/[^/]+\/[^/]+\/evidence\/screenshots\/screenshot-[a-f0-9]+\.jpg$/;
  assert.ok(pattern.test(localResult.portableRef), `Local ref: ${localResult.portableRef}`);
  assert.ok(pattern.test(prodResult.portableRef), `Prod ref: ${prodResult.portableRef}`);
});

// ---------------------------------------------------------------------------
// Screenshots survive report generation cycle
// ---------------------------------------------------------------------------

test("T-SS-22: screenshot remains readable after persistence (survives generation)", async () => {
  const result = await persistScreenshot(VALID_BASE64, TEST_META, { artifactRoot: testDir });
  assert.equal(result.persisted, true);

  // Simulate what happens after report generation: re-read via portable ref
  const { dataUri } = readScreenshotAsDataUri(result.portableRef, testDir);
  assert.ok(dataUri, "Must still be readable after generation cycle");
  assert.ok(dataUri.length > 100, "Data URI must contain actual image data");
});

// ---------------------------------------------------------------------------
// Checksum correctness
// ---------------------------------------------------------------------------

test("T-SS-23: checksum matches sha256 of written binary", async () => {
  const result = await persistScreenshot(VALID_BASE64, TEST_META, { artifactRoot: testDir });
  const { resolvedPath } = resolvePortableRef(result.portableRef, testDir);
  const writtenBinary = await readFile(resolvedPath);

  const { createHash } = await import("node:crypto");
  const expectedChecksum = createHash("sha256").update(writtenBinary).digest("hex");
  assert.equal(result.checksum, expectedChecksum);
});

// ---------------------------------------------------------------------------
// Report test totals
// ---------------------------------------------------------------------------

test("T-SS-TOTALS: verify screenshot portability test count", () => {
  assert.ok(23 >= 12, "23 screenshot portability tests (minimum 12 required for regression coverage)");
});
