from pathlib import Path


def replace_exact(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FAIL-CLOSED: {path}: expected exactly 1 anchor, found {count}")
    p.write_text(text.replace(old, new, 1))
    print(f"patched {path}")


# ACT-01 — web contract carries an explicit governed report design.
replace_exact(
    "lib/audit-request.ts",
    'export interface AuditFormInput {\n',
    'export type ReportDesignVersion = "1.0.0" | "2.0.0";\n\nexport interface AuditFormInput {\n',
)
replace_exact(
    "lib/audit-request.ts",
    '  gscSiteUrl?: string;\n}',
    '  gscSiteUrl?: string;\n  reportDesignVersion?: ReportDesignVersion;\n}',
)
replace_exact(
    "lib/audit-request.ts",
    '  if (input.market && input.market.length > 128) {\n    errors.market = "Market or location must be 128 characters or fewer.";\n  }\n\n  // GA4: digits only',
    '  if (input.market && input.market.length > 128) {\n    errors.market = "Market or location must be 128 characters or fewer.";\n  }\n  if (input.reportDesignVersion && !["1.0.0", "2.0.0"].includes(input.reportDesignVersion)) {\n    errors.reportDesignVersion = "Report design must be 1.0.0 or 2.0.0.";\n  }\n\n  // GA4: digits only',
)
replace_exact(
    "lib/audit-request.ts",
    '  if (input.competitors?.length) payload.competitors = input.competitors.filter((c) => c.trim());\n\n  if (input.ga4PropertyId?.trim()) {',
    '  if (input.competitors?.length) payload.competitors = input.competitors.filter((c) => c.trim());\n  if (input.reportDesignVersion) payload.report = { designVersion: input.reportDesignVersion };\n\n  if (input.ga4PropertyId?.trim()) {',
)

replace_exact(
    "app/audits/new/page.tsx",
    'import { validateAuditForm, buildAuditPayload, type AuditFormInput } from "@/lib/audit-request";',
    'import { validateAuditForm, buildAuditPayload, type AuditFormInput, type ReportDesignVersion } from "@/lib/audit-request";',
)
replace_exact(
    "app/audits/new/page.tsx",
    '  const [customGoal, setCustomGoal] = useState("");\n  const [errors, setErrors] = useState<Record<string, string>>({});',
    '  const [customGoal, setCustomGoal] = useState("");\n  const [reportDesignVersion, setReportDesignVersion] = useState<ReportDesignVersion>("2.0.0");\n  const [errors, setErrors] = useState<Record<string, string>>({});',
)
replace_exact(
    "app/audits/new/page.tsx",
    '      services: parseServices(servicesRaw),\n      primaryGoal: goal || "Generate qualified enquiries",\n    };',
    '      services: parseServices(servicesRaw),\n      primaryGoal: goal || "Generate qualified enquiries",\n      reportDesignVersion,\n    };',
)
replace_exact(
    "app/audits/new/page.tsx",
    '        <div className="form-group">\n          <label htmlFor="competitor1">Competitor websites <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional, up to 3)</span></label>',
    '        <div className="form-group">\n          <label htmlFor="reportDesignVersion">Report design *</label>\n          <select\n            id="reportDesignVersion"\n            value={reportDesignVersion}\n            onChange={(e) => setReportDesignVersion(e.target.value as ReportDesignVersion)}\n          >\n            <option value="2.0.0">Prysm Report v2 — current</option>\n            <option value="1.0.0">Prysm Report v1 — legacy</option>\n          </select>\n          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: 6 }}>\n            v2 is the current governed executive report. v1 remains available for historical compatibility.\n          </p>\n        </div>\n\n        <div className="form-group">\n          <label htmlFor="competitor1">Competitor websites <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional, up to 3)</span></label>',
)

# ACT-02 — both canonical application boundaries preserve report.designVersion.
replace_exact(
    "services/worker/src/application/audit-service.js",
    '    };\n\n    // Attach optional analytics',
    '    };\n    if (input.report?.designVersion) {\n      auditRequest.report = { designVersion: input.report.designVersion };\n    }\n\n    // Attach optional analytics',
)
replace_exact(
    "services/worker/src/application/production-runtime.js",
    '    };\n    if (input.ga4?.propertyId) auditRequest.ga4 = { propertyId: String(input.ga4.propertyId).replace(/\\D/g, "") };',
    '    };\n    if (input.report?.designVersion) {\n      auditRequest.report = { designVersion: input.report.designVersion };\n    }\n    if (input.ga4?.propertyId) auditRequest.ga4 = { propertyId: String(input.ga4.propertyId).replace(/\\D/g, "") };',
)

# ACT-03 — production approval resolves the persisted design before loading v1 pages.
replace_exact(
    "services/worker/src/application/production-runtime.js",
    '''    let governedPages = pages;
    if (!(governedPages instanceof Map)) {
      governedPages = new Map();
      for (const filename of REQUIRED_APPROVED_PAGE_FILENAMES) {
        const key = `tenants/${tenantId}/clients/${current.clientId}/audits/${auditId}/report/pages/${filename}`;
        const bytes = await artifactStore.get(key);
        if (!bytes) throw Object.assign(new Error(`Draft report page missing: ${filename}`), { statusCode: 422 });
        governedPages.set(filename, Buffer.from(bytes).toString("utf8"));
      }
    }

    const result = await baseAuditService.approveAudit(auditId, tenantId, slug, approver, governedPages);''',
    '''    const persistedRequest = await loadAuditRequest({
      store: artifactStore,
      scope: { tenantId, clientId: current.clientId, auditId },
      validateContract: runtimeValidateContract,
    }).catch(() => null);
    const reportDesignVersion = persistedRequest?.report?.designVersion || "1.0.0";

    let governedPages = pages;
    if (reportDesignVersion === "2.0.0") {
      // v2 is immutable in the governed report-v2 namespace. Do not require
      // or synthesize the locked v1 16-page set before delegating to the
      // existing v2 approval branch in the base application service.
      governedPages = undefined;
    } else if (!(governedPages instanceof Map)) {
      governedPages = new Map();
      for (const filename of REQUIRED_APPROVED_PAGE_FILENAMES) {
        const key = `tenants/${tenantId}/clients/${current.clientId}/audits/${auditId}/report/pages/${filename}`;
        const bytes = await artifactStore.get(key);
        if (!bytes) throw Object.assign(new Error(`Draft report page missing: ${filename}`), { statusCode: 422 });
        governedPages.set(filename, Buffer.from(bytes).toString("utf8"));
      }
    }

    const result = await baseAuditService.approveAudit(auditId, tenantId, slug, approver, governedPages);
    if (reportDesignVersion === "2.0.0" && result?.designVersion !== "2.0.0") {
      throw Object.assign(new Error("Report v2 approval failed closed: governed v2 artifacts were not approved"), { statusCode: 422 });
    }''',
)

# ACT-04 — remove obsolete shared reviewer-cookie UX gate only.
replace_exact(
    "app/audits/[auditId]/page.tsx",
    'import { cookies } from "next/headers";\nimport { REVIEWER_COOKIE, isValidReviewerToken } from "@/lib/reviewer-auth";\n',
    '',
)
replace_exact(
    "app/audits/[auditId]/page.tsx",
    '''          {isValidReviewerToken(cookies().get(REVIEWER_COOKIE)?.value) ? (
            <>
              <p>The governed draft report is ready for review. Pages are visible only to the reviewer.</p>
              <a href={`/audits/${auditId}/report`} className="btn btn-primary">View Draft Report</a>
            </>
          ) : (
            <p>Draft reports are reviewer-only. Sign in as a reviewer to open the internal review page.</p>
          )}''',
    '''          <p>The governed draft report is ready for review. Tenant, role, and lifecycle access are enforced by the worker before any report bytes are returned.</p>
          <a href={`/audits/${auditId}/report`} className="btn btn-primary">View Draft Report</a>''',
)

# ACT-05 — expose existing admin product surface; server remains authoritative.
replace_exact(
    "app/layout.tsx",
    '              <a href="/audits/new">New Audit</a>\n              {authenticated ? <LogoutButton /> : <a href="/login">Sign in</a>}',
    '              <a href="/audits/new">New Audit</a>\n              {authenticated && <a href="/admin">Admin</a>}\n              {authenticated ? <LogoutButton /> : <a href="/login">Sign in</a>}',
)

# Browser proof: v2 selection + reviewer principal alone + admin navigation.
replace_exact(
    "tests/wp11/full-flow.spec.ts",
    '    await page.selectOption("#audienceScope", "local");\n    console.log("  [x] Step  4: Select competing-audience scope");',
    '    await page.selectOption("#audienceScope", "local");\n    await page.selectOption("#reportDesignVersion", "2.0.0");\n    console.log("  [x] Step  4: Select competing-audience scope + report v2");',
)
replace_exact(
    "tests/wp11/full-flow.spec.ts",
    '    await expect(page.locator("#primaryGoal")).toHaveCount(1);\n    await expect(page.locator("#ga4")).toHaveCount(0);',
    '    await expect(page.locator("#primaryGoal")).toHaveCount(1);\n    await expect(page.locator("#reportDesignVersion")).toHaveValue("2.0.0");\n    await expect(page.locator("#ga4")).toHaveCount(0);',
)
replace_exact(
    "tests/wp11/full-flow.spec.ts",
    '        services: ["Consulting"],\n      },\n    });\n    expect(createRes.status()).toBe(201);',
    '        services: ["Consulting"],\n        report: { designVersion: "2.0.0" },\n      },\n    });\n    expect(createRes.status()).toBe(201);',
)
replace_exact(
    "tests/wp11/full-flow.spec.ts",
    '''    // 3. Establish the reviewer session (secret-protected issuance; the
    //    cookie is shared with the page's browser context — temporary
    //    internal compatibility path).
    const sessionRes = await page.request.post(`${NEXT_URL}/api/reviewer-session`, {
      headers: { "x-vantage-secret": "test-secret" },
    });
    expect(sessionRes.status()).toBe(200);
    console.log("  [x] DRAFT-REVIEW-01: reviewer session issued");

    // 4. Open the audit detail page and wait for the draft review card.''',
    '''    // 3. Open the audit detail page using ONLY the authenticated reviewer
    // principal. No legacy reviewer-session cookie is issued.
    // 4. Wait for the draft review card.''',
)
replace_exact(
    "tests/wp11/full-flow.spec.ts",
    '    expect(bodyText.length).toBeGreaterThan(100);\n    console.log("  [x] DRAFT-REVIEW-01: report page rendered (no 404)");',
    '    expect(bodyText.length).toBeGreaterThan(100);\n    expect(bodyText).toContain("Report design v2.0.0");\n    console.log("  [x] DRAFT-REVIEW-01: governed v2 report rendered using reviewer login only");',
)
replace_exact(
    "tests/wp11/full-flow.spec.ts",
    '  test("DRAFT-REVIEW-03: anonymous draft report access is blocked (reviewer session required)", async ({ request }) => {',
    '  test("DRAFT-REVIEW-03: anonymous draft report access is blocked (authenticated principal required)", async ({ request }) => {',
)

replace_exact(
    "tests/provisioning/admin-flow.spec.ts",
    '  await login(page, "admin@test.example.com", "anything");\n  await page.goto(`${NEXT_URL}/admin`);\n  await expect(page.getByText("Platform administration")).toBeVisible();',
    '  await login(page, "admin@test.example.com", "anything");\n  await page.goto(NEXT_URL);\n  const adminLink = page.getByRole("link", { name: "Admin" });\n  await expect(adminLink).toHaveAttribute("href", "/admin");\n  await adminLink.click();\n  await page.waitForURL("**/admin");\n  await expect(page.getByText("Platform administration")).toBeVisible();',
)

# Correct escaped WP-I proof: canonical request must carry v2 from intake.
replace_exact(
    "services/worker/scripts/acceptance-wpi.js",
    'check(rawEv?.json?.services?.length === 2, "business context persisted in the governed request");\n',
    'check(rawEv?.json?.services?.length === 2, "business context persisted in the governed request");\ncheck(rawEv?.json?.report?.designVersion === "2.0.0", "intake persisted governed report design v2.0.0");\n',
)

# Production-runtime behavioural regression inside existing npm-test glob.
Path("services/worker/src/audit/production-activation.test.js").write_text('''import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createProductionRuntime } from "../application/production-runtime.js";
import { createMemoryLifecycleRepository } from "../lifecycle/memory-repository.js";
import { createLifecycleService } from "../lifecycle/lifecycle-service.js";
import { LIFECYCLE_STATE as T } from "../lifecycle/state-enum.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";
import { createGovernedArtifactStore } from "../storage/governed-artifact-store.js";
import { persistAuditRequest, loadAuditRequest } from "../orchestration/audit-request-persistence.js";
import { buildArtifactKey } from "../storage/artifact-key.js";

function controlledAdapters() {
  const adapter = (name) => ({
    adapterVersion: "activation-test-1.0.0",
    execute: async () => {
      const err = new Error(`controlled ${name} stop`);
      err.category = "validation";
      throw err;
    },
  });
  return {
    "dataforseo-onpage": adapter("onpage"),
    pagespeed: adapter("pagespeed"),
    "dataforseo-serp": adapter("serp"),
    backlinks: adapter("backlinks"),
    ga4: adapter("ga4"),
    gsc: adapter("gsc"),
  };
}

function makeRuntime({ rejectV1Approval = false } = {}) {
  const lifecycleRepo = createMemoryLifecycleRepository();
  const artifactStore = createGovernedArtifactStore({ store: createMemoryArtifactStore() });
  let v1ApprovalCalls = 0;
  const reportStore = {
    async writeApprovedPages() {
      v1ApprovalCalls += 1;
      if (rejectV1Approval) throw new Error("v1 approval path must not run for report v2");
      return { status: "approved", approval: {}, artifacts: [] };
    },
    async getStatus() { return null; },
  };
  const runtime = createProductionRuntime({
    config: { narrativeMode: "mock" },
    adapters: controlledAdapters(),
    artifactStore,
    lifecycleRepo,
    reportStore,
  });
  return { runtime, lifecycleRepo, artifactStore, getV1ApprovalCalls: () => v1ApprovalCalls };
}

async function driveToReview(lifecycleService, auditId, tenantId) {
  const states = [
    T.VALIDATED, T.COLLECTING, T.EVIDENCE_STORED, T.EVIDENCE_LOCKED,
    T.SCORED, T.NARRATIVE_PENDING, T.NARRATIVE_READY, T.DRAFT_RENDERED, T.IN_REVIEW,
  ];
  for (const toState of states) {
    const current = await lifecycleService.currentState(auditId, tenantId);
    await lifecycleService.transition({
      auditId,
      tenantId,
      toState,
      expectedState: current.state,
      expectedVersion: current.version,
      transitionIdempotencyKey: `activation:${auditId}:${toState}`,
      actor: "activation-test",
      reason: "controlled production activation regression",
    });
  }
}

describe("PRYSM-ACTIVATE-01 production boundary", () => {
  it("production createAudit persists explicit v2 and preserves v1 fallback when omitted", async () => {
    const { runtime, artifactStore } = makeRuntime();
    const tenantId = "activation-tenant";

    const v2 = await runtime.auditService.createAudit({
      targetUrl: "https://activation-v2.example.com",
      businessName: "Activation V2",
      report: { designVersion: "2.0.0" },
    }, tenantId);
    const v2Request = await loadAuditRequest({
      store: artifactStore,
      scope: { tenantId, clientId: v2.clientId, auditId: v2.auditId },
      validateContract: runtime.validateContract,
    });
    assert.equal(v2Request.report?.designVersion, "2.0.0");

    const legacy = await runtime.auditService.createAudit({
      targetUrl: "https://activation-v1.example.com",
      businessName: "Activation V1",
    }, tenantId);
    const legacyRequest = await loadAuditRequest({
      store: artifactStore,
      scope: { tenantId, clientId: legacy.clientId, auditId: legacy.auditId },
      validateContract: runtime.validateContract,
    });
    assert.equal(legacyRequest.report, undefined, "omitted design must preserve governed v1 default");
  });

  it("production approval for persisted v2 skips every locked-v1 page read and approves report-v2", async () => {
    const { runtime, lifecycleRepo, artifactStore, getV1ApprovalCalls } = makeRuntime({ rejectV1Approval: true });
    const lifecycleService = createLifecycleService(lifecycleRepo);
    const tenantId = "activation-tenant";
    const clientId = "activation-client";
    const auditId = randomUUID();
    const idempotencyKey = randomUUID();

    await lifecycleService.create({ auditId, tenantId, clientId, idempotencyKey });
    await driveToReview(lifecycleService, auditId, tenantId);

    const auditRequest = {
      contractVersion: "1.0.0",
      auditId,
      tenantId,
      clientId,
      idempotencyKey,
      targetUrl: "https://activation-approval.example.com/",
      businessName: "Activation Approval",
      market: "",
      language: "en-CA",
      primaryGoal: "",
      services: [],
      competitors: [],
      report: { designVersion: "2.0.0" },
    };
    await persistAuditRequest({
      store: artifactStore,
      auditRequest,
      validateContract: runtime.validateContract,
    });

    await artifactStore.put({
      bytes: Buffer.from(JSON.stringify({ reportDesignVersion: "2.0.0", status: "draft" })),
      contentType: "application/json",
      scope: { tenantId, clientId, auditId, category: "report-v2", artifactName: "manifest.json" },
    });
    await artifactStore.put({
      bytes: Buffer.from("<!doctype html><html><body>Report design v2.0.0</body></html>"),
      contentType: "text/html; charset=utf-8",
      scope: { tenantId, clientId, auditId, category: "report-v2", artifactName: "pages/index.html" },
    });

    const approved = await runtime.auditService.approveAudit(
      auditId, tenantId, "activation-approval", "activation-reviewer",
    );

    assert.equal(approved.designVersion, "2.0.0");
    assert.equal(approved.status, T.APPROVED);
    assert.equal(getV1ApprovalCalls(), 0, "v1 report-store approval must not run for v2");
    const current = await lifecycleService.currentState(auditId, tenantId);
    assert.equal(current.state, T.APPROVED);

    const approvedKey = buildArtifactKey({
      tenantId, clientId, auditId,
      category: "report-v2", artifactName: "approved-manifest.json",
    });
    const approvedManifest = await artifactStore.get(approvedKey);
    assert.ok(approvedManifest && approvedManifest.length > 0, "immutable v2 approved manifest must exist");
  });
});
''')

print("all exact activation patches applied")
