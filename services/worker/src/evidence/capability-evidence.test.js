import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITIES,
  CAPABILITY_EVIDENCE_VERSION,
  buildCapabilityEvidence,
  persistCapabilityEvidence,
  loadAndValidateCapabilityEvidence,
} from "./capability-evidence.js";
import { createMemoryArtifactStore } from "../storage/memory-artifact-store.js";

// PRYSM-NEXT-01 WP-C — capability evidence v2 truth tables.

const NOW = "2026-08-16T12:00:00.000Z";
const AUDIT_ID = "11111111-2222-4333-8444-555555555555";

function baseSite(overrides = {}) {
  return {
    sourceStatus: "AVAILABLE",
    adapterVersion: "1.1.0",
    targetUrl: "https://example.com/",
    domain: "example.com",
    pages: [],
    services: [],
    ctas: [],
    forms: [],
    schemaTypes: [],
    microdataTypes: [],
    trust: {},
    securityHeaders: {},
    _contentEvidenceAvailable: true,
    _responseHeadersAvailable: false,
    acquisition: {},
    ...overrides,
  };
}

function evidenceOf({ site = null, performance = null } = {}) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site,
    performance,
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
  };
}

function cap(result, name) {
  return result.capabilities[name];
}

// ---------------------------------------------------------------------------
// WP-C-02 / WP-C-05 — truth table cases
// ---------------------------------------------------------------------------

test("full evidence: content + deep acquisitions + performance → content/technical/performance AVAILABLE", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        contentParsing: [
          {
            url: "https://example.com/",
            wordCount: 9,
            mainContentChars: 40,
            hasMainContent: true,
            sentimentScore: null,
          },
        ],
        redirectChains: [
          {
            from: "https://example.com/",
            to: "https://example.com/home",
            statusCodes: [301],
            hops: 1,
          },
        ],
        nonIndexablePages: [],
        pageResources: [
          {
            url: "https://example.com/",
            totalResources: 12,
            brokenResources: 0,
          },
        ],
        schemaTypes: ["Organization"],
        acquisition: {
          contentParsing: { requested: 1, completed: 1, failed: 0 },
          redirectChains: { requested: 1, completed: 1, failed: 0 },
          nonIndexable: { requested: 1000, completed: 0, failed: 0 },
          resources: { requested: 1, completed: 1, failed: 0 },
          microdata: { requested: 1, completed: 1, failed: 0 },
        },
        _responseHeadersAvailable: true,
      }),
      performance: {
        sourceStatus: "AVAILABLE",
        provider: "pagespeed-insights",
        coverage: { requested: 2, completed: 2, failed: 0 },
        fieldData: { lcp: "2.0s" },
      },
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(result.capabilityEvidenceVersion, "2.0.0");
  assert.equal(cap(result, "content.body").status, "AVAILABLE");
  assert.equal(cap(result, "offer.clarity").status, "AVAILABLE");
  assert.equal(cap(result, "trust.proof").status, "AVAILABLE");
  assert.equal(cap(result, "conversion.cta").status, "AVAILABLE");
  assert.equal(cap(result, "conversion.form").status, "AVAILABLE");
  assert.equal(cap(result, "technical.indexability").status, "AVAILABLE");
  assert.equal(cap(result, "technical.redirects").status, "AVAILABLE");
  assert.equal(cap(result, "technical.resources").status, "AVAILABLE");
  assert.equal(cap(result, "technical.headers").status, "AVAILABLE");
  assert.equal(cap(result, "schema.structured_data").status, "AVAILABLE");
  assert.equal(cap(result, "performance.lab").status, "AVAILABLE");
  assert.equal(cap(result, "performance.field").status, "AVAILABLE");
  assert.equal(cap(result, "conversion.path").status, "AVAILABLE");
  assert.equal(cap(result, "conversion.path").kind, "inferred");
  assert.equal(cap(result, "conversion.path").validated, false);
  assert.equal(result.summary.total, 13);
  assert.equal(result.summary.assessed, 13);
});

test("no content: DFS metadata-only crawl → content capabilities UNAVAILABLE, never false-absent", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        _contentEvidenceAvailable: false,
        acquisition: {
          contentParsing: { requested: 3, completed: 0, failed: 3 },
          redirectChains: { requested: 3, completed: 3, failed: 0 },
          nonIndexable: { requested: 1000, completed: 2, failed: 0 },
          resources: { requested: 3, completed: 3, failed: 0 },
          microdata: { requested: 1, completed: 1, failed: 0 },
        },
      }),
      performance: {
        sourceStatus: "AVAILABLE",
        coverage: { requested: 2, completed: 2, failed: 0 },
        fieldData: {},
      },
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(cap(result, "content.body").status, "UNAVAILABLE");
  assert.equal(cap(result, "offer.clarity").status, "UNAVAILABLE");
  assert.equal(cap(result, "trust.proof").status, "UNAVAILABLE");
  assert.equal(cap(result, "conversion.cta").status, "UNAVAILABLE");
  assert.equal(cap(result, "conversion.form").status, "UNAVAILABLE");
  assert.equal(cap(result, "conversion.path").status, "UNAVAILABLE");

  assert.equal(cap(result, "technical.redirects").status, "AVAILABLE");
  assert.equal(cap(result, "technical.indexability").status, "AVAILABLE");
  assert.equal(cap(result, "technical.resources").status, "AVAILABLE");

  assert.equal(cap(result, "schema.structured_data").status, "AVAILABLE");
  assert.equal(cap(result, "performance.field").status, "UNAVAILABLE");
  assert.equal(cap(result, "trust.proof").requiredFieldsPresent, false);
});

test("partial content: some pages parsed → content.body PARTIAL, others follow truthfully", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        _contentEvidenceAvailable: false,
        contentParsing: [
          {
            url: "https://example.com/",
            wordCount: 120,
            mainContentChars: 700,
            hasMainContent: true,
            sentimentScore: null,
            text: "Usable page body content",
          },
        ],
        acquisition: {
          contentParsing: { requested: 3, completed: 1, failed: 2 },
          redirectChains: { requested: 3, completed: 1, failed: 2 },
          nonIndexable: { requested: 1000, completed: 5, failed: 0 },
          resources: { requested: 3, completed: 1, failed: 2 },
        },
      }),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(cap(result, "content.body").status, "PARTIAL");
  assert.equal(cap(result, "technical.redirects").status, "PARTIAL");
  assert.equal(cap(result, "technical.resources").status, "PARTIAL");
  assert.equal(cap(result, "technical.indexability").status, "AVAILABLE");
});

test("no schema anywhere and content unknown → schema capability UNAVAILABLE (not false-absent)", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({ _contentEvidenceAvailable: undefined }),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(cap(result, "schema.structured_data").status, "UNAVAILABLE");
  assert.equal(cap(result, "content.body").status, "UNAVAILABLE");
  assert.equal(cap(result, "technical.headers").status, "UNAVAILABLE");
});

test("no performance evidence at all → lab UNAVAILABLE, field UNAVAILABLE", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
      performance: null,
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(cap(result, "performance.lab").status, "UNAVAILABLE");
  assert.equal(cap(result, "performance.field").status, "UNAVAILABLE");
});

test("provider failure → performance.lab FAILED, performance.field UNAVAILABLE", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
      performance: {
        sourceStatus: "FAILED",
        limitations: ["both providers failed"],
      },
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(cap(result, "performance.lab").status, "FAILED");
  assert.equal(cap(result, "performance.field").status, "UNAVAILABLE");
});

test("content parsing completion without usable fields → content.body UNAVAILABLE", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        _contentEvidenceAvailable: false,
        contentParsing: [
          {
            url: "https://example.com/",
            wordCount: null,
            mainContentChars: null,
            hasMainContent: false,
            sentimentScore: null,
            text: "",
          },
        ],
        acquisition: {
          contentParsing: {
            requested: 1,
            completed: 1,
            failed: 0,
          },
        },
      }),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(cap(result, "content.body").status, "UNAVAILABLE");
  assert.equal(cap(result, "content.body").requiredFieldsPresent, false);
  assert.deepEqual(cap(result, "content.body").coverage, {
    requested: 1,
    completed: 0,
    failed: 1,
  });
});

test("malformed acquisition shape → capability degrades to UNAVAILABLE, never throws", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        _contentEvidenceAvailable: false,
        acquisition: {
          contentParsing: "not-an-object",
        },
      }),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(cap(result, "content.body").status, "UNAVAILABLE");
});

test("determinism: identical evidence produces identical capability records", () => {
  const mk = () =>
    buildCapabilityEvidence({
      decisionEvidence: evidenceOf({
        site: baseSite({
          contentParsing: [
            {
              url: "https://example.com/",
              wordCount: 3,
              mainContentChars: 10,
              hasMainContent: true,
              sentimentScore: null,
            },
          ],
          acquisition: {
            contentParsing: {
              requested: 1,
              completed: 1,
              failed: 0,
            },
          },
          schemaTypes: ["WebPage"],
        }),
        performance: {
          sourceStatus: "PARTIAL",
          coverage: {
            requested: 2,
            completed: 1,
            failed: 1,
          },
        },
      }),
      auditId: AUDIT_ID,
      generatedAt: NOW,
    });

  assert.deepEqual(mk(), mk());
});

test("all 13 capabilities present with canonical vocabulary", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  for (const name of CAPABILITIES) {
    assert.ok(result.capabilities[name], `capability ${name} present`);

    const allowed = [
      "AVAILABLE",
      "PARTIAL",
      "UNAVAILABLE",
      "FAILED",
      "NOT_CONNECTED",
      "NOT_APPLICABLE",
    ];

    assert.ok(
      allowed.includes(result.capabilities[name].status),
      `${name} status canonical`,
    );

    assert.ok(
      result.capabilities[name].provenance,
      `${name} has provenance`,
    );
  }
});

// ---------------------------------------------------------------------------
// WP-C-04 — persistence round-trip + fail-closed validation
// ---------------------------------------------------------------------------

function stubValidator(valid) {
  return (schemaId, obj) => {
    if (schemaId.includes("capability-evidence")) {
      return {
        valid,
        errors: valid ? [] : [{ message: "controlled invalid" }],
      };
    }

    return {
      valid: true,
      errors: [],
    };
  };
}

test("persist + load round-trip preserves capability evidence exactly", async () => {
  const store = createMemoryArtifactStore();

  const evidence = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  const scope = {
    tenantId: "t1",
    clientId: "c1",
    auditId: AUDIT_ID,
  };

  const record = await persistCapabilityEvidence({
    store,
    scope,
    evidence,
    validateContract: stubValidator(true),
  });

  assert.ok(record.key.includes("capability-evidence.json"));

  const loaded = await loadAndValidateCapabilityEvidence({
    store,
    scope,
    validateContract: stubValidator(true),
  });

  assert.deepEqual(loaded, evidence);
});

test("persist fails closed on schema-invalid capability evidence", async () => {
  const store = createMemoryArtifactStore();

  const evidence = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  await assert.rejects(
    persistCapabilityEvidence({
      store,
      scope: {
        tenantId: "t1",
        clientId: "c1",
        auditId: AUDIT_ID,
      },
      evidence,
      validateContract: stubValidator(false),
    }),
    /validation failed/,
  );
});

test("load rejects corrupt (non-JSON) artifacts", async () => {
  const store = createMemoryArtifactStore();

  const scope = {
    tenantId: "t1",
    clientId: "c1",
    auditId: AUDIT_ID,
  };

  await store.put({
    bytes: Buffer.from("{not json", "utf-8"),
    contentType: "application/json",
    scope: {
      ...scope,
      category: "canonical",
      artifactName: "capability-evidence.json",
    },
  });

  await assert.rejects(
    loadAndValidateCapabilityEvidence({
      store,
      scope,
      validateContract: stubValidator(true),
    }),
    /not valid JSON/,
  );
});

test("load rejects schema-invalid artifacts", async () => {
  const store = createMemoryArtifactStore();

  const evidence = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  const scope = {
    tenantId: "t1",
    clientId: "c1",
    auditId: AUDIT_ID,
  };

  await persistCapabilityEvidence({
    store,
    scope,
    evidence,
    validateContract: stubValidator(true),
  });

  await assert.rejects(
    loadAndValidateCapabilityEvidence({
      store,
      scope,
      validateContract: stubValidator(false),
    }),
    /validation failed on load/,
  );
});

// ---------------------------------------------------------------------------
// WP-E-03 — Playwright validation upgrades conversion.path capability
// ---------------------------------------------------------------------------

function validationEvidence(overrides = {}) {
  return {
    provider: "playwright-conversion-path",
    status: overrides.status ?? "PASS",
    pages:
      overrides.pages ?? [
        {
          url: "https://example.com/contact",
          role: "conversion",
          status: "PASS",
          checks: {
            desktop: {
              cta: {
                found: true,
                visible: true,
                interactable: true,
                target: "https://example.com/book",
                targetResolves: true,
                obstructed: false,
              },
            },
            mobile: {
              cta: {
                found: true,
                visible: true,
                interactable: true,
                target: "https://example.com/book",
                targetResolves: true,
                obstructed: false,
              },
            },
          },
          limitations: [],
          screenshotRef: null,
        },
      ],
    summary:
      overrides.summary ?? {
        requested: 1,
        pass: 1,
        partial: 0,
        failed: 0,
        notAssessed: 0,
      },
    limitations: [],
  };
}

test("WP-E-03: completed validation upgrades conversion.path to validated", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
    pathValidationEvidence: validationEvidence({}),
  });

  const path = cap(result, "conversion.path");

  assert.equal(path.status, "AVAILABLE");
  assert.equal(path.kind, "validated");
  assert.equal(path.validated, true);
  assert.equal(path.validatedBy, "playwright-conversion-path");
  assert.equal(path.validationSummary.pass, 1);
  assert.equal(path.coverage.requested, 1);
});

test("WP-E-03: mixed validation results produce validated capability with honest summary", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
    pathValidationEvidence: validationEvidence({
      status: "PARTIAL",
      pages: [
        validationEvidence({}).pages[0],
        {
          url: "https://example.com/",
          role: "home",
          status: "FAILED",
          checks: {},
          limitations: [],
          screenshotRef: null,
        },
      ],
      summary: {
        requested: 2,
        pass: 1,
        partial: 0,
        failed: 1,
        notAssessed: 0,
      },
    }),
  });

  const path = cap(result, "conversion.path");

  assert.equal(path.validated, true);
  assert.equal(path.kind, "validated");
  assert.equal(path.validationSummary.failed, 1);
});

test("WP-E-03: browser NOT_ASSESSED keeps the inferred state (no penalty)", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
    pathValidationEvidence: {
      provider: "playwright-conversion-path",
      status: "NOT_ASSESSED",
      pages: [],
      summary: {
        requested: 2,
        pass: 0,
        partial: 0,
        failed: 0,
        notAssessed: 2,
      },
      limitations: ["Browser launch failed"],
    },
  });

  const path = cap(result, "conversion.path");

  assert.equal(path.validated, false);
  assert.equal(path.kind, "inferred");
  assert.ok(
    path.limitations.some((l) => l.includes("launch failed")),
  );
});

// ---------------------------------------------------------------------------
// CRIT defect 2a — interactive evidence rules (parsed text ≠ CTA/form proof)
// ---------------------------------------------------------------------------

test("CRIT 2a: text-only source never claims CTA/form/path availability from parsed content", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        ctas: [],
        forms: [],
        _interactiveEvidenceAvailable: false,
      }),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(
    cap(result, "content.body").status,
    "AVAILABLE",
    "parsed content counts as content evidence",
  );

  assert.equal(
    cap(result, "conversion.cta").status,
    "UNAVAILABLE",
    "empty CTAs on a text-only source are unknown",
  );

  assert.ok(
    cap(result, "conversion.cta").limitations.some((l) =>
      l.includes("not extracted"),
    ),
  );

  assert.equal(
    cap(result, "conversion.form").status,
    "UNAVAILABLE",
  );

  assert.equal(
    cap(result, "conversion.path").status,
    "UNAVAILABLE",
    "no path evidence without interactive extraction",
  );
});

test("CRIT 2a: text-only source WITH CTA arrays (browser pass) claims availability", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        ctas: [
          {
            text: "Book",
            url: "https://example.com/book",
          },
        ],
        forms: [],
        _interactiveEvidenceAvailable: false,
      }),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(
    cap(result, "conversion.cta").status,
    "AVAILABLE",
  );

  assert.equal(
    cap(result, "conversion.form").status,
    "UNAVAILABLE",
    "forms still unextracted",
  );
});

test("CRIT 2a: legacy extractor (marker absent) keeps confirmed-absence semantics", () => {
  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite({
        ctas: [],
        forms: [],
      }),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
  });

  assert.equal(
    cap(result, "conversion.cta").status,
    "AVAILABLE",
    "confirmed absence via legacy extractor",
  );

  assert.equal(
    cap(result, "conversion.form").status,
    "AVAILABLE",
  );
});

test("WP-E-03: obstruction counts surface in the validation summary", () => {
  const obstructedPage = {
    url: "https://example.com/contact",
    role: "conversion",
    status: "FAILED",
    checks: {
      desktop: {
        cta: {
          found: true,
          visible: true,
          interactable: true,
          target: "https://example.com/book",
          targetResolves: true,
          obstructed: true,
        },
      },
      mobile: {
        cta: {
          found: true,
          visible: true,
          interactable: true,
          target: "https://example.com/book",
          targetResolves: true,
          obstructed: false,
        },
      },
    },
    limitations: [],
    screenshotRef: null,
  };

  const result = buildCapabilityEvidence({
    decisionEvidence: evidenceOf({
      site: baseSite(),
    }),
    auditId: AUDIT_ID,
    generatedAt: NOW,
    pathValidationEvidence: validationEvidence({
      status: "FAILED",
      pages: [obstructedPage],
      summary: {
        requested: 1,
        pass: 0,
        partial: 0,
        failed: 1,
        notAssessed: 0,
      },
    }),
  });

  const path = cap(result, "conversion.path");

  assert.equal(
    path.validated,
    true,
    "collected failure evidence is still validated evidence",
  );

  assert.equal(
    path.validationSummary.obstructionCount,
    1,
  );
});
