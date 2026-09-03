import test from "node:test";
import assert from "node:assert/strict";
import { scoreAudit } from "./vantage-score.js";
import {
  checkModuleEligibility,
  calculateEvidenceConfidence,
  MODULES,
} from "./score-components.js";
import { buildCapabilityEvidence } from "../evidence/capability-evidence.js";
import { SOURCE_STATUS } from "./evidence-contracts.js";

// PRYSM-NEXT-01 WP-D — scoring v4 truth tables, weighting defect proof,
// capability eligibility, business context, funnel stages, AI claims,
// findings gating, confidence availability.

const FIXED_TS = "2026-01-15T12:00:00.000Z";
const INPUT = {
  targetUrl: "https://x.com",
  businessName: "X",
  competitors: [],
};

function site(overrides = {}) {
  return {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    targetUrl: "https://x.com/",
    domain: "x.com",
    pageCount: 2,
    pages: [
      {
        title: "Home",
        headings: {
          h1: ["Home"],
          h2: [],
          h3: [],
          h4: [],
        },
        responseHeaders: {},
      },
    ],
    services: ["Coaching"],
    topicKeywords: ["coaching support"],
    ctas: [
      {
        text: "Book",
        url: "https://x.com/book",
        kind: "link",
      },
    ],
    forms: [],
    schemaTypes: [],
    microdataTypes: [],
    socialLinks: [],
    trust: {
      testimonials: false,
      credentials: false,
      caseStudies: false,
      faq: false,
      pricing: false,
      policies: false,
      contact: true,
    },
    securityHeaders: {
      xFrameOptions: true,
      xContentTypeOptions: true,
      referrerPolicy: true,
      contentSecurityPolicy: true,
    },
    totalWords: 800,
    averageWords: 400,
    missingTitles: 0,
    missingDescriptions: 0,
    missingCanonicals: 0,
    h1Missing: 0,
    h1Multiple: 0,
    imageCount: 2,
    imagesMissingAlt: 0,
    internalLinkCount: 2,
    brokenInternalLinks: [],
    statusCounts: {},
    limitations: [],
    collectedAt: FIXED_TS,
    coverage: {
      requested: 2,
      completed: 2,
      failed: 0,
    },
    _contentEvidenceAvailable: true,
    _responseHeadersAvailable: true,
    ...overrides,
  };
}

function perf(overrides = {}) {
  return {
    sourceStatus: SOURCE_STATUS.AVAILABLE,
    provider: "pagespeed-insights",
    mobile: {
      status: SOURCE_STATUS.AVAILABLE,
      scores: {
        performance: 55,
      },
      metrics: {},
    },
    desktop: {
      status: SOURCE_STATUS.AVAILABLE,
      scores: {
        performance: 96,
      },
      metrics: {},
    },
    fieldData: {},
    limitations: [],
    collectedAt: FIXED_TS,
    coverage: {
      requested: 2,
      completed: 2,
      failed: 0,
    },
    ...overrides,
  };
}

function evidenceOf({ site: s, performance: p } = {}) {
  return {
    contractVersion: "1.0.0",
    decisionEvidenceVersion: "1.0.0",
    site: s === null ? null : (s || site()),
    performance: p === null ? null : (p || perf()),
    competitors: null,
    backlinks: null,
    ga4: null,
    gsc: null,
  };
}

function capsOf(ev) {
  return buildCapabilityEvidence({
    decisionEvidence: ev,
    auditId: "wpd-caps",
    generatedAt: FIXED_TS,
  }).capabilities;
}

// ---------------------------------------------------------------------------
// WP-D-01 — weighting defect proven and corrected
// ---------------------------------------------------------------------------

test(
  "WP-D-01: overall readiness is the ASSESSED-weight-weighted mean (buggy full-weight numerator rejected)",
  () => {
    const model = scoreAudit(INPUT, evidenceOf());

    assert.equal(model.assessedWeight, 97);
    assert.equal(model.scores.conversionReadiness, 33);

    const partial = scoreAudit(
      INPUT,
      evidenceOf({
        site: site({
          _responseHeadersAvailable: false,
        }),
      }),
    );

    assert.equal(partial.assessedWeight, 84);
    assert.equal(partial.scores.conversionReadiness, 29);

    assert.ok(
      partial.suppressedModules.some(
        (m) => m.moduleId === "risk_reduction",
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// WP-D-02/03/04 — capability eligibility truth tables through scoreAudit
// ---------------------------------------------------------------------------

test(
  "WP-D-02: DFS metadata-only crawl suppresses content modules but keeps technical/performance/schema",
  () => {
    const dfsSite = site({
      _contentEvidenceAvailable: false,
      _responseHeadersAvailable: false,
      acquisition: {
        contentParsing: {
          requested: 3,
          completed: 0,
          failed: 3,
        },
        redirectChains: {
          requested: 3,
          completed: 3,
          failed: 0,
        },
        nonIndexable: {
          requested: 1000,
          completed: 2,
          failed: 0,
        },
        resources: {
          requested: 3,
          completed: 3,
          failed: 0,
        },
        microdata: {
          requested: 1,
          completed: 1,
          failed: 0,
        },
      },
    });

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: dfsSite,
      }),
    );

    for (const id of [
      "trust_signals",
      "offer_clarity",
      "conversion_paths",
      "content_depth",
      "funnel_coverage",
      "risk_reduction",
    ]) {
      assert.equal(
        model.moduleEligibility[id],
        false,
        `${id} must be suppressed without content evidence`,
      );
    }

    assert.equal(
      model.moduleEligibility.technical_hygiene,
      true,
    );

    assert.equal(
      model.moduleEligibility.performance,
      true,
    );

    assert.equal(
      model.moduleEligibility.schema_entity,
      true,
    );

    assert.equal(
      model.moduleEligibility.ai_readiness,
      true,
    );

    assert.equal(model.assessedWeight, 25);
    assert.equal(model.showNumericScore, false);

    assert.equal(
      model.readinessStatus,
      "Insufficient Evidence for Overall Score",
    );

    assert.equal(
      model.scores.trust,
      null,
      "unknown content must never lower the trust score — it is null",
    );

    assert.notEqual(
      model.scores.technical,
      null,
    );

    assert.ok(
      model.suppressedModules.some(
        (m) =>
          /trust\.proof/.test(
            m.reason || "",
          ),
      ),
    );
  },
);

test(
  "WP-D-04: no schema anywhere → schema modules suppressed; assessed weight exact",
  () => {
    const dfsSite = site({
      _contentEvidenceAvailable: false,
      _responseHeadersAvailable: false,
      acquisition: {
        microdata: {
          requested: 1,
          completed: 0,
          failed: 1,
        },
      },
    });

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: dfsSite,
      }),
    );

    assert.equal(
      model.moduleEligibility.schema_entity,
      false,
    );

    assert.equal(
      model.moduleEligibility.ai_readiness,
      false,
    );

    assert.equal(
      model.assessedWeight,
      16,
    );
  },
);

test(
  "WP-D-02: no performance evidence → performance module suppressed (UNAVAILABLE, not zero)",
  () => {
    const model = scoreAudit(
      INPUT,
      evidenceOf({
        performance: null,
      }),
    );

    assert.equal(
      model.moduleEligibility.performance,
      false,
    );

    assert.equal(
      model.scores.performance,
      null,
    );

    assert.ok(
      model.suppressedModules.some(
        (m) =>
          m.moduleId === "performance" &&
          /performance\.lab/.test(
            m.reason || "",
          ),
      ),
    );
  },
);

test(
  "WP-D-02: provider failure (performance FAILED) suppresses the performance module",
  () => {
    const model = scoreAudit(
      INPUT,
      evidenceOf({
        performance: perf({
          sourceStatus: SOURCE_STATUS.FAILED,
          status: SOURCE_STATUS.FAILED,
          limitations: [
            "both providers failed",
          ],
        }),
      }),
    );

    assert.equal(
      model.moduleEligibility.performance,
      false,
    );

    assert.equal(
      model.scores.performance,
      null,
    );
  },
);

test(
  "WP-D-09: partial usable content parsing keeps content.body modules eligible with PARTIAL capability",
  () => {
    const s = site({
      _contentEvidenceAvailable: false,
      contentParsing: [
        {
          url: "https://x.com/",
          wordCount: 120,
          mainContentChars: 700,
          hasMainContent: true,
          sentimentScore: null,
          text: "Usable page body content",
        },
      ],
      acquisition: {
        contentParsing: {
          requested: 3,
          completed: 1,
          failed: 2,
        },
      },
    });

    const caps = capsOf(
      evidenceOf({
        site: s,
      }),
    );

    assert.equal(
      caps["content.body"].status,
      "PARTIAL",
    );

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: s,
      }),
    );

    assert.equal(
      model.moduleEligibility.content_depth,
      true,
      "PARTIAL usable content evidence is usable for content.body modules",
    );

    assert.equal(
      model.moduleEligibility.trust_signals,
      false,
    );
  },
);

test(
  "WP-D-09: completed parsing without usable content keeps content.body modules suppressed",
  () => {
    const s = site({
      _contentEvidenceAvailable: false,
      contentParsing: [
        {
          url: "https://x.com/",
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
    });

    const caps = capsOf(
      evidenceOf({
        site: s,
      }),
    );

    assert.equal(
      caps["content.body"].status,
      "UNAVAILABLE",
    );

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: s,
      }),
    );

    assert.equal(
      model.moduleEligibility.content_depth,
      false,
    );

    assert.equal(
      model.moduleEligibility.trust_signals,
      false,
    );
  },
);

// ---------------------------------------------------------------------------
// WP-D-05 — business context
// ---------------------------------------------------------------------------

test(
  "WP-D-05: intake services change content scoring deterministically",
  () => {
    const ev = evidenceOf();
    const base = scoreAudit(
      INPUT,
      ev,
    );

    const withCtx = scoreAudit(
      {
        ...INPUT,
        services: [
          "Executive Coaching",
          "Leadership Development",
          "Team Facilitation",
        ],
      },
      ev,
    );

    assert.ok(
      withCtx.scores.contentDepth >
        base.scores.contentDepth,
      "intake services must strengthen the content-depth score",
    );

    assert.equal(
      withCtx.contentIdeas.tofu[0].idea.startsWith(
        "What Is Executive Coaching",
      ),
      true,
      "content ideas must lead with the business-context service",
    );

    assert.equal(
      withCtx.scores.performance,
      base.scores.performance,
    );
  },
);

test(
  "WP-D-06: readinessMap stages derive from page purpose — never index % 3",
  () => {
    const s = site({
      services: [
        "Coaching",
        "Workshops",
        "Advisory",
      ],
      pages: [
        {
          crawledUrl:
            "https://x.com/coaching",
          title: "Coaching",
          headings: {
            h1: ["Coaching"],
            h2: [],
            h3: [],
            h4: [],
          },
          forms: [
            {
              action: "/submit",
            },
          ],
        },
        {
          crawledUrl:
            "https://x.com/workshops",
          title: "Workshops Guide",
          headings: {
            h1: ["What are Workshops?"],
            h2: [],
            h3: [],
            h4: [],
          },
        },
        {
          crawledUrl:
            "https://x.com/advisory",
          title: "Advisory Case Studies",
          headings: {
            h1: ["Client Results"],
            h2: [],
            h3: [],
            h4: [],
          },
        },
      ],
    });

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: s,
      }),
    );

    const rows =
      model.readinessMap;

    assert.equal(
      rows[0].topic,
      "Coaching",
    );

    assert.equal(
      rows[0].stage,
      "BOFU",
      "form-bearing page is BOFU",
    );

    assert.equal(
      rows[1].stage,
      "TOFU",
      "guide page is TOFU",
    );

    assert.equal(
      rows[2].stage,
      "MOFU",
      "case-study page is MOFU",
    );

    assert.deepEqual(
      Object.keys(
        rows[0],
      ).sort(),
      [
        "blocker",
        "cta",
        "eeat",
        "path",
        "priority",
        "stage",
        "topic",
        "trustAsset",
      ].sort(),
    );
  },
);

test(
  "WP-D-06: service with no matching page → deterministic site-level fallback (v1 enum), never fabricated",
  () => {
    const s = site({
      services: [
        "Mystery Service",
      ],
      forms: [],
      trust: {
        ...site().trust,
        pricing: false,
        testimonials: false,
        caseStudies: false,
      },
      pages: [
        {
          title: "Unrelated",
          headings: {
            h1: ["Unrelated"],
            h2: [],
            h3: [],
            h4: [],
          },
          responseHeaders: {},
        },
      ],
    });

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: s,
      }),
    );

    const row =
      model.readinessMap.find(
        (r) =>
          r.topic ===
          "Mystery Service",
      );

    assert.equal(
      row.stage,
      "TOFU",
    );

    const s2 = site({
      services: [
        "Mystery Service",
      ],
      forms: [
        {
          action: "/submit",
        },
      ],
      pages: [
        {
          title: "Unrelated",
          headings: {
            h1: ["Unrelated"],
            h2: [],
            h3: [],
            h4: [],
          },
          responseHeaders: {},
        },
      ],
    });

    const model2 = scoreAudit(
      INPUT,
      evidenceOf({
        site: s2,
      }),
    );

    const row2 =
      model2.readinessMap.find(
        (r) =>
          r.topic ===
          "Mystery Service",
      );

    assert.equal(
      row2.stage,
      "BOFU",
    );
  },
);

// ---------------------------------------------------------------------------
// WP-D-07 — AI-readiness claims
// ---------------------------------------------------------------------------

test(
  "WP-D-07: aiReadiness has no floor for unknown; basis and limitation recorded",
  () => {
    const s = site({
      _responseHeadersAvailable: false,
    });

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: s,
      }),
    );

    assert.equal(
      model.aiReadinessBasis,
      "structural",
    );

    const withSchema = site({
      schemaTypes: [
        "Organization",
        "LocalBusiness",
        "Service",
      ],
    });

    const modelSchema =
      scoreAudit(
        INPUT,
        evidenceOf({
          site: withSchema,
        }),
      );

    assert.ok(
      modelSchema.scores.aiReadiness >
        model.scores.aiReadiness,
      "schema presence must raise structural readiness",
    );

    assert.equal(
      model.aiReadinessLimitation,
      null,
      "schema capability available → no limitation",
    );
  },
);

// ---------------------------------------------------------------------------
// WP-D-11 — findings gating
// ---------------------------------------------------------------------------

test(
  "WP-D-11: content findings suppressed with reasons when content is unknown",
  () => {
    const dfsSite = site({
      _contentEvidenceAvailable: false,
      _responseHeadersAvailable: false,
      acquisition: {
        microdata: {
          requested: 1,
          completed: 0,
          failed: 1,
        },
      },
    });

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: dfsSite,
      }),
    );

    const ruleIds =
      new Set(
        model.findings.map(
          (f) => f.ruleId,
        ),
      );

    assert.ok(
      !ruleIds.has(
        "VAN-TRUST-001",
      ),
      "trust finding must be suppressed",
    );

    assert.ok(
      !ruleIds.has(
        "VAN-TRUST-002",
      ),
      "pricing finding must be suppressed",
    );

    assert.ok(
      !ruleIds.has(
        "VAN-CONTENT-002",
      ),
      "faq finding must be suppressed",
    );

    assert.ok(
      !ruleIds.has(
        "VAN-TECH-003",
      ),
      "headers finding must be suppressed",
    );

    assert.ok(
      !ruleIds.has(
        "VAN-SCHEMA-001",
      ),
      "schema finding must be suppressed (unknown)",
    );

    assert.ok(
      model.suppressedFindingReasons.some(
        (r) =>
          r.ruleId ===
            "VAN-TRUST-001" &&
          r.capability ===
            "trust.proof",
      ),
      "suppression reasons must record the capability",
    );
  },
);

test(
  "WP-D-11: full evidence keeps confirmed-absence findings",
  () => {
    const model = scoreAudit(
      INPUT,
      evidenceOf(),
    );

    const ruleIds =
      new Set(
        model.findings.map(
          (f) => f.ruleId,
        ),
      );

    assert.ok(
      ruleIds.has(
        "VAN-TRUST-001",
      ),
      "confirmed absence still produces findings",
    );

    assert.ok(
      ruleIds.has(
        "VAN-SCHEMA-001",
      ),
      "confirmed schema absence still produces findings",
    );

    assert.equal(
      model.suppressedFindingReasons.length,
      0,
    );
  },
);

// ---------------------------------------------------------------------------
// WP-D-12 — confidence unknown-factor handling
// ---------------------------------------------------------------------------

test(
  "WP-D-12: unknown confidence factors are excluded, not imputed at 50",
  () => {
    const ev = evidenceOf();

    delete ev.site.coverage;
    ev.performance = null;

    const result =
      calculateEvidenceConfidence(
        ev,
        [],
        FIXED_TS,
      );

    assert.equal(
      result.factors.dataCompleteness,
      null,
    );

    assert.ok(
      typeof result.factors
        .dataFreshness ===
        "number",
    );

    assert.equal(
      result.factors.ruleCertainty,
      null,
    );

    const availability =
      Object.fromEntries(
        result.factorAvailability.map(
          (f) => [
            f.factor,
            f.available,
          ],
        ),
      );

    assert.equal(
      availability.dataCompleteness,
      false,
    );

    assert.equal(
      availability.ruleCertainty,
      false,
    );

    assert.equal(
      availability.dataFreshness,
      true,
    );

    assert.ok(
      result.score >= 0 &&
        result.score <= 100,
    );
  },
);

// ---------------------------------------------------------------------------
// CRIT rescore #4 — behavioural proof for the unknown≠credit corrections
// ---------------------------------------------------------------------------

test(
  "CRIT rescore: null meta/image counters exclude the meta/images sub-rules",
  () => {
    const ev = evidenceOf();

    ev.site.missingTitles = null;
    ev.site.missingDescriptions = null;
    ev.site.missingCanonicals = null;
    ev.site.h1Missing = null;
    ev.site.h1Multiple = null;
    ev.site.imageCount = null;
    ev.site.imagesMissingAlt = null;

    ev.site.acquisition = {
      redirectChains: {
        requested: 2,
        completed: 2,
        failed: 0,
      },
      nonIndexable: {
        requested: 1000,
        completed: 2,
        failed: 0,
      },
      resources: {
        requested: 2,
        completed: 2,
        failed: 0,
      },
    };

    ev.site.redirectChains = [];
    ev.site.nonIndexablePages = [];

    ev.site.pageResources = [
      {
        url: "https://x.com/",
        totalResources: 5,
        brokenResources: 0,
      },
    ];

    const model = scoreAudit(
      INPUT,
      ev,
    );

    const tech =
      model.moduleScores
        .technical_hygiene;

    const subKeys =
      (
        tech.subScores ||
        []
      ).map(
        (s) => s.key,
      );

    assert.ok(
      !subKeys.includes(
        "meta",
      ),
      "meta sub-rule excluded when counters unknown",
    );

    assert.ok(
      !subKeys.includes(
        "images",
      ),
      "images sub-rule excluded when counts unknown",
    );

    assert.ok(
      tech.subWeightAssessed <
        tech.subWeightTotal,
      "unknown evidence reduces the assessed sub-weight",
    );
  },
);

test(
  "Interpretation integrity: unknown image evidence cannot emit VAN-TECH-004",
  () => {
    const unknown = scoreAudit(
      INPUT,
      evidenceOf({
        site: site({
          _metaCountersAvailable: false,
          imageCount: 0,
          imagesMissingAlt: 3,
        }),
      }),
    );

    assert.ok(
      !unknown.findings.some(
        (f) =>
          f.ruleId ===
          "VAN-TECH-004",
      ),
      "unknown image counters must not create a missing-alt finding",
    );

    const known = scoreAudit(
      INPUT,
      evidenceOf({
        site: site({
          _metaCountersAvailable: true,
          imageCount: 3,
          imagesMissingAlt: 1,
        }),
      }),
    );

    assert.ok(
      known.findings.some(
        (f) =>
          f.ruleId ===
          "VAN-TECH-004",
      ),
      "confirmed missing-alt evidence must still create the finding",
    );
  },
);

test(
  "CRIT rescore: indexability PARTIAL with empty list grants no credit",
  () => {
    const ev = evidenceOf();

    ev.site.acquisition = {
      nonIndexable: {
        requested: 1000,
        completed: 2,
        failed: 998,
      },
      redirectChains: {
        requested: 2,
        completed: 2,
        failed: 0,
      },
    };

    ev.site.nonIndexablePages = [];
    ev.site.redirectChains = [];

    const model = scoreAudit(
      INPUT,
      ev,
    );

    const tech =
      model.moduleScores
        .technical_hygiene;

    const subKeys =
      (
        tech.subScores ||
        []
      ).map(
        (s) => s.key,
      );

    assert.ok(
      !subKeys.includes(
        "indexability",
      ),
      "failed/partial indexability evidence grants no credit",
    );
  },
);

test(
  "CRIT rescore: offerClarity descCoverage grants no credit from unknown counters",
  () => {
    const ev = evidenceOf();

    ev.site.missingDescriptions =
      null;

    const offerKnown =
      scoreAudit(
        INPUT,
        evidenceOf(),
      ).moduleScores
        .offer_clarity.score;

    const offerUnknown =
      scoreAudit(
        INPUT,
        ev,
      ).moduleScores
        .offer_clarity.score;

    assert.ok(
      offerUnknown <
        offerKnown,
      `unknown (${offerUnknown}) < known (${offerKnown})`,
    );

    assert.ok(
      offerKnown -
        offerUnknown <=
        15,
      `descCoverage delta bounded by the 15-point term (got ${
        offerKnown -
        offerUnknown
      })`,
    );
  },
);

test(
  "CRIT rescore R1: mixed partial collection excludes only the uncollected field",
  () => {
    const ev = evidenceOf();

    ev.site._metaFieldAvailability =
      {
        titles: true,
        descriptions: false,
        canonicals: true,
        headings: true,
      };

    ev.site.missingDescriptions =
      null;

    const model = scoreAudit(
      INPUT,
      ev,
    );

    const tech =
      model.moduleScores
        .technical_hygiene;

    const metaSub =
      (
        tech.subScores ||
        []
      ).find(
        (s) =>
          s.key ===
          "meta",
      );

    assert.ok(
      metaSub,
      "collected fields still score",
    );

    assert.equal(
      metaSub.weight,
      35,
      "descriptions term (15) excluded; titles+canonicals+headings = 35",
    );

    const offerWith =
      scoreAudit(
        INPUT,
        evidenceOf(),
      ).moduleScores
        .offer_clarity.score;

    const offerMixed =
      model.moduleScores
        .offer_clarity.score;

    assert.ok(
      offerMixed <
        offerWith,
      "descCoverage excluded for the uncollected field",
    );
  },
);

test(
  "CRIT rescore: redirects PARTIAL without collected evidence grants no credit",
  () => {
    const ev = evidenceOf();

    ev.site.acquisition = {
      redirectChains: {
        requested: 3,
        completed: 0,
        failed: 3,
      },
    };

    ev.site.redirectChains = [];

    const model = scoreAudit(
      INPUT,
      ev,
    );

    const tech =
      model.moduleScores
        .technical_hygiene;

    const subKeys =
      (
        tech.subScores ||
        []
      ).map(
        (s) => s.key,
      );

    assert.ok(
      !subKeys.includes(
        "redirects",
      ),
      "uncollected redirect evidence grants no credit",
    );
  },
);

test(
  "CRIT rescore: resources with null totals grant no credit",
  () => {
    const ev = evidenceOf();

    ev.site.acquisition = {
      resources: {
        requested: 2,
        completed: 2,
        failed: 0,
      },
      redirectChains: {
        requested: 2,
        completed: 2,
        failed: 0,
      },
    };

    ev.site.pageResources = [
      {
        url: "https://x.com/",
        totalResources: null,
        brokenResources: null,
      },
    ];

    ev.site.redirectChains = [];

    const model = scoreAudit(
      INPUT,
      ev,
    );

    const tech =
      model.moduleScores
        .technical_hygiene;

    const subKeys =
      (
        tech.subScores ||
        []
      ).map(
        (s) => s.key,
      );

    assert.ok(
      !subKeys.includes(
        "resources",
      ),
      "null resource totals grant no credit",
    );
  },
);

test(
  "CRIT rescore: readinessMap rows assert Not Assessed without trust evidence",
  () => {
    const s = site({
      _contentEvidenceAvailable: false,
      _interactiveEvidenceAvailable: false,
      services: [
        "Mystery Service",
      ],
      ctas: [],
      forms: [],
      pages: [
        {
          title: "Unrelated",
          headings: {
            h1: ["Unrelated"],
            h2: [],
            h3: [],
            h4: [],
          },
          responseHeaders: {},
        },
      ],
    });

    const model = scoreAudit(
      INPUT,
      evidenceOf({
        site: s,
      }),
    );

    const row =
      model.readinessMap.find(
        (r) =>
          r.topic ===
          "Mystery Service",
      );

    assert.equal(
      row.blocker,
      "Not Assessed",
      "no trust claims from unknown evidence",
    );

    assert.equal(
      row.trustAsset,
      "Not Assessed",
    );

    assert.equal(
      row.eeat,
      "Not Assessed",
    );

    assert.equal(
      row.cta,
      "Not Assessed",
      "no invented CTA-type claim",
    );

    assert.equal(
      row.path,
      "Not Assessed",
      "path absence asserted only when extraction ran",
    );
  },
);

// ---------------------------------------------------------------------------
// WP-D-10 — repeatability at model level
// ---------------------------------------------------------------------------

test(
  "WP-D-10: identical evidence + context produces identical models (3×)",
  () => {
    const ev = evidenceOf();

    const a = scoreAudit(
      INPUT,
      ev,
    );

    const b = scoreAudit(
      INPUT,
      ev,
    );

    const c = scoreAudit(
      INPUT,
      ev,
    );

    assert.deepEqual(
      JSON.parse(
        JSON.stringify(b),
      ),
      JSON.parse(
        JSON.stringify(a),
      ),
    );

    assert.deepEqual(
      JSON.parse(
        JSON.stringify(c),
      ),
      JSON.parse(
        JSON.stringify(a),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// WP-E-05 — validated conversion-path evidence in scoring v4.1
// ---------------------------------------------------------------------------

function validationEvidence(overrides = {}) {
  return {
    provider:
      "playwright-conversion-path",
    status:
      overrides.status ??
      "PASS",
    pages:
      overrides.pages ?? [
        {
          url:
            "https://x.com/contact",
          role: "conversion",
          status: "PASS",
          checks: {
            desktop: {
              cta: {
                found: true,
                visible: true,
                interactable: true,
                target:
                  "https://x.com/book",
                targetResolves: true,
                obstructed: false,
              },
            },
            mobile: {
              cta: {
                found: true,
                visible: true,
                interactable: true,
                target:
                  "https://x.com/book",
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

test(
  "WP-E-05: validated paths raise the conversion score; NOT_ASSESSED validation equals inferred baseline",
  () => {
    const ev = evidenceOf();

    const inferred =
      scoreAudit(
        INPUT,
        ev,
      );

    const validatedCaps =
      buildCapabilityEvidence({
        decisionEvidence: ev,
        auditId:
          "wpe-caps",
        generatedAt:
          FIXED_TS,
        pathValidationEvidence:
          validationEvidence({}),
      });

    const validated =
      scoreAudit(
        INPUT,
        ev,
        {
          capabilityEvidence:
            validatedCaps,
        },
      );

    assert.ok(
      validated.scores
        .conversionPathways >
        inferred.scores
          .conversionPathways,
      `validated ${
        validated.scores
          .conversionPathways
      } must exceed inferred ${
        inferred.scores
          .conversionPathways
      }`,
    );

    const notAssessedCaps =
      buildCapabilityEvidence({
        decisionEvidence: ev,
        auditId:
          "wpe-caps-na",
        generatedAt:
          FIXED_TS,
        pathValidationEvidence: {
          provider:
            "playwright-conversion-path",
          status:
            "NOT_ASSESSED",
          pages: [],
          summary: {
            requested: 2,
            pass: 0,
            partial: 0,
            failed: 0,
            notAssessed: 2,
          },
          limitations: [
            "browser unavailable",
          ],
        },
      });

    const notAssessed =
      scoreAudit(
        INPUT,
        ev,
        {
          capabilityEvidence:
            notAssessedCaps,
        },
      );

    assert.equal(
      notAssessed.scores
        .conversionPathways,
      inferred.scores
        .conversionPathways,
      "validation NOT_ASSESSED must not change the inferred score",
    );
  },
);

test(
  "WP-E-05: obstructed validated path emits VAN-PATH-001 with evidence",
  () => {
    const ev = evidenceOf();

    const obstructedCaps =
      buildCapabilityEvidence({
        decisionEvidence: ev,
        auditId:
          "wpe-obstructed",
        generatedAt:
          FIXED_TS,
        pathValidationEvidence:
          validationEvidence({
            status:
              "FAILED",
            pages: [
              {
                url:
                  "https://x.com/contact",
                role:
                  "conversion",
                status:
                  "FAILED",
                checks: {
                  desktop: {
                    cta: {
                      found: true,
                      visible: true,
                      interactable: true,
                      target:
                        "https://x.com/book",
                      targetResolves:
                        true,
                      obstructed:
                        true,
                    },
                  },
                  mobile: {
                    cta: {
                      found: true,
                      visible: true,
                      interactable: true,
                      target:
                        "https://x.com/book",
                      targetResolves:
                        true,
                      obstructed:
                        false,
                    },
                  },
                },
                limitations: [],
                screenshotRef:
                  null,
              },
            ],
            summary: {
              requested: 1,
              pass: 0,
              partial: 0,
              failed: 1,
              notAssessed: 0,
            },
          }),
      });

    const model = scoreAudit(
      INPUT,
      ev,
      {
        capabilityEvidence:
          obstructedCaps,
      },
    );

    const finding =
      model.findings.find(
        (f) =>
          f.ruleId ===
          "VAN-PATH-001",
      );

    assert.ok(
      finding,
      "obstruction finding must be emitted",
    );

    assert.equal(
      finding.evidence[0]
        .provider,
      "playwright-conversion-path",
    );

    assert.equal(
      finding.evidence[0]
        .observedValue,
      1,
    );

    assert.equal(
      finding.scoreBearing,
      true,
    );
  },
);
test("INTERPRETATION-07: PARTIAL source status is preserved in finding evidence", () => {
  const model = scoreAudit(
    INPUT,
    evidenceOf({
      site: site({
        sourceStatus: SOURCE_STATUS.PARTIAL,
        missingDescriptions: 1,
      }),
    }),
  );

  const finding = model.findings.find(
    (item) => item.ruleId === "VAN-TECH-001",
  );

  assert.ok(finding);
  assert.equal(
    finding.evidence[0].sourceStatus,
    SOURCE_STATUS.PARTIAL,
  );
  assert.notEqual(
    finding.evidence[0].sourceStatus,
    SOURCE_STATUS.AVAILABLE,
  );
});
test("INTERPRETATION-05: measured slow LCP produces bounded business impact, not an asserted commercial outcome", () => {
  const model = scoreAudit(
    INPUT,
    evidenceOf({
      performance: perf({
        mobile: {
          status: SOURCE_STATUS.AVAILABLE,
          source: "pagespeed-insights",
          scores: { performance: 35 },
          metrics: { lcpMs: 6962 },
        },
      }),
    }),
  );

  const finding = model.findings.find(
    (item) => item.ruleId === "VAN-PERF-001",
  );

  assert.ok(finding, "VAN-PERF-001 must be emitted for measured slow LCP");

  assert.equal(
    finding.businessImpact,
    "Slow LCP may create friction for mobile visitors.",
  );

  assert.doesNotMatch(
    finding.businessImpact,
    /\b(abandonment|lost revenue|lost conversions?|reduced conversions?|ranking loss)\b/i,
  );
});
// ---------------------------------------------------------------------------
// PF-01 / PF-02 / PF-03 — PARTIAL evidence semantics and report integrity
// ---------------------------------------------------------------------------

function pfCapability(
  status,
  overrides = {},
) {
  return {
    status,
    requiredFieldsPresent:
      status ===
        SOURCE_STATUS.AVAILABLE ||
      status ===
        SOURCE_STATUS.PARTIAL,
    coverage: {
      requested: null,
      completed: null,
      failed: null,
    },
    limitations: [],
    ...overrides,
  };
}

test(
  "PF-01/PF-02: unassessed cross-capability signals are excluded and contribute only fractional assessed weight",
  () => {
    const capabilities = {
      "content.body":
        pfCapability(
          SOURCE_STATUS.AVAILABLE,
        ),

      "offer.clarity":
        pfCapability(
          SOURCE_STATUS.AVAILABLE,
        ),

      "trust.proof":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "conversion.cta":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "conversion.form":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "conversion.path":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.indexability":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.redirects":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.resources":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.headers":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "schema.structured_data":
        pfCapability(
          SOURCE_STATUS.AVAILABLE,
        ),

      "performance.lab":
        pfCapability(
          SOURCE_STATUS.AVAILABLE,
        ),

      "performance.field":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),
    };

    const model = scoreAudit(
      INPUT,
      evidenceOf(),
      {
        capabilityEvidence: {
          capabilityEvidenceVersion:
            "2.0.0",
          summary: {},
          capabilities,
        },
        scoredAt:
          FIXED_TS,
      },
    );

    assert.equal(
      model.moduleScores
        .offer_clarity
        .subWeightAssessed,
      35,
      "offer clarity must exclude CTA, form, and pricing signals when their governing capabilities were not assessed",
    );

    assert.equal(
      model.moduleScores
        .content_depth
        .subWeightAssessed,
      85,
      "content depth must exclude FAQ when trust evidence was not assessed",
    );

    assert.equal(
      model.moduleScores
        .technical_hygiene
        .subWeightAssessed,
      60,
      "technical hygiene must count only assessed technical signals",
    );

    assert.equal(
      model.assessedWeight,
      38,
      "fractional module assessment must survive into overall assessed weight",
    );

    assert.equal(
      model.showNumericScore,
      false,
      "incomplete assessed coverage must not be presented as a complete numeric readiness result",
    );
  },
);

test(
  "PF-01: observed PARTIAL technical defects remain score-bearing while clean unassessed remainder cannot grant PASS credit",
  () => {
    const unavailable =
      pfCapability(
        SOURCE_STATUS.UNAVAILABLE,
        {
          requiredFieldsPresent:
            false,
        },
      );

    const observedPartial =
      MODULES
        .technical_hygiene
        .scorer(
          null,
          null,
          {
            site: site({
              sourceStatus:
                SOURCE_STATUS.PARTIAL,

              nonIndexablePages: [
                {
                  url:
                    "https://x.com/private",
                },
              ],

              redirectChains: [],
              pageResources: [],
            }),

            capabilities: {
              "technical.indexability":
                pfCapability(
                  SOURCE_STATUS.PARTIAL,
                ),

              "technical.redirects":
                unavailable,

              "technical.resources":
                unavailable,

              "technical.headers":
                unavailable,
            },
          },
        );

    assert.ok(
      observedPartial.subScores.some(
        (row) =>
          row.key ===
            "indexability" &&
          row.score === 7,
      ),
      "a defect actually observed in PARTIAL evidence must remain score-bearing",
    );

    const cleanPartial =
      MODULES
        .technical_hygiene
        .scorer(
          null,
          null,
          {
            site: site({
              sourceStatus:
                SOURCE_STATUS.PARTIAL,

              nonIndexablePages: [],
              redirectChains: [],
              pageResources: [],
            }),

            capabilities: {
              "technical.indexability":
                pfCapability(
                  SOURCE_STATUS.PARTIAL,
                ),

              "technical.redirects":
                unavailable,

              "technical.resources":
                unavailable,

              "technical.headers":
                unavailable,
            },
          },
        );

    assert.ok(
      !cleanPartial.subScores.some(
        (row) =>
          row.key ===
          "indexability",
      ),
      "an empty PARTIAL result must not establish a complete indexability PASS",
    );
  },
);

test(
  "PF-03: PARTIAL absence findings preserve assessed scope and buyer-question finding requires content evidence",
  () => {
    const partialCapabilities = {
      "content.body":
        pfCapability(
          SOURCE_STATUS.PARTIAL,
        ),

      "trust.proof":
        pfCapability(
          SOURCE_STATUS.PARTIAL,
        ),

      "offer.clarity":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "conversion.cta":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "conversion.form":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "conversion.path":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.indexability":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.redirects":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.resources":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "technical.headers":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "schema.structured_data":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),

      "performance.lab":
        pfCapability(
          SOURCE_STATUS.AVAILABLE,
        ),

      "performance.field":
        pfCapability(
          SOURCE_STATUS.UNAVAILABLE,
          {
            requiredFieldsPresent:
              false,
          },
        ),
    };

    const partialEvidence =
      evidenceOf({
        site: site({
          contentParsing: [
            {
              url:
                "https://x.com/assessed",
              text:
                "Observed body content from the assessed representative page.",
              wordCount: 120,
              mainContentChars: 700,
            },
          ],
        }),
      });

    const partialModel =
      scoreAudit(
        INPUT,
        partialEvidence,
        {
          capabilityEvidence: {
            capabilityEvidenceVersion:
              "2.0.0",
            summary: {},
            capabilities:
              partialCapabilities,
          },
          scoredAt:
            FIXED_TS,
        },
      );

    const buyerQuestion =
      partialModel.findings.find(
        (finding) =>
          finding.ruleId ===
          "VAN-CONTENT-002",
      );

    assert.ok(
      buyerQuestion,
      "buyer-question opportunity must remain visible when usable PARTIAL content evidence exists",
    );

    assert.equal(
      buyerQuestion.title,
      "Buyer-question content was not detected in the available partial assessment",
    );

    assert.match(
      buyerQuestion.evidenceText,
      /available partial assessment/i,
    );

    assert.equal(
      buyerQuestion
        .evidence[0]
        .sourceStatus,
      SOURCE_STATUS.PARTIAL,
    );

    assert.deepEqual(
      buyerQuestion.affectedUrls,
      [
        "https://x.com/assessed",
      ],
      "PARTIAL absence language must be bounded to assessed content URLs when they are known",
    );

    const partialTrust =
      partialModel.findings.find(
        (finding) =>
          finding.ruleId ===
          "VAN-TRUST-001",
      );

    assert.ok(partialTrust);

    assert.doesNotMatch(
      partialTrust.title,
      /^No\b|\babsent\b|\bmissing\b/i,
      "PARTIAL trust evidence must not become an unqualified whole-site absence claim",
    );

    assert.equal(
      partialTrust
        .evidence[0]
        .sourceStatus,
      SOURCE_STATUS.PARTIAL,
    );

    const partialPricing =
      partialModel.findings.find(
        (finding) =>
          finding.ruleId ===
          "VAN-TRUST-002",
      );

    assert.ok(partialPricing);

    assert.doesNotMatch(
      partialPricing.title,
      /^No\b|\babsent\b|\bmissing\b/i,
      "PARTIAL pricing evidence must not become an unqualified whole-site absence claim",
    );

    const unavailableContentModel =
      scoreAudit(
        INPUT,
        partialEvidence,
        {
          capabilityEvidence: {
            capabilityEvidenceVersion:
              "2.0.0",
            summary: {},
            capabilities: {
              ...partialCapabilities,

              "content.body":
                pfCapability(
                  SOURCE_STATUS.UNAVAILABLE,
                  {
                    requiredFieldsPresent:
                      false,
                  },
                ),
            },
          },
          scoredAt:
            FIXED_TS,
        },
      );

    assert.ok(
      !unavailableContentModel
        .findings.some(
          (finding) =>
            finding.ruleId ===
            "VAN-CONTENT-002",
        ),
      "trust.proof alone must never authorize the buyer-question absence finding",
    );
  },
);

test(
  "VAN-SCHEMA mixed-status: AVAILABLE schema capability must not inherit PARTIAL site status",
  () => {
    const ev = evidenceOf({
      site: site({
        sourceStatus: SOURCE_STATUS.PARTIAL,
        schemaTypes: [],
      }),
    });

    const model = scoreAudit(
      INPUT,
      ev,
      {
        capabilityEvidence: {
          capabilityEvidenceVersion: "2.0.0",
          summary: {},
          capabilities: {
            "schema.structured_data": {
              status: SOURCE_STATUS.AVAILABLE,
              requiredFieldsPresent: true,
              coverage: {
                requested: 1,
                completed: 1,
                failed: 0,
              },
              limitations: [],
            },
          },
        },
        scoredAt: FIXED_TS,
      },
    );

    const finding = model.findings.find(
      (item) => item.ruleId === "VAN-SCHEMA-001",
    );

    assert.ok(
      finding,
      "confirmed schema absence must still emit VAN-SCHEMA-001",
    );

    assert.equal(
      finding.evidence[0].sourceStatus,
      SOURCE_STATUS.AVAILABLE,
      "schema finding evidence must use schema capability status, not broader PARTIAL site status",
    );

    assert.equal(
      finding.title,
      "No structured data detected",
    );
  },
);
