/**
 * Authoritative deterministic client-truth projection for material cross-report
 * assertions. Existing string constructs remain a compatibility view; new
 * client-facing consumers must use `truth` through requireClientTruth().
 */

export const CLIENT_TRUTH_VERSION = "2.0.0";
export const CLIENT_TRUTH_STATE = Object.freeze({
  ASSESSED: "assessed",
  PARTIAL: "partial",
  NOT_ASSESSED: "not assessed",
  NOT_APPLICABLE: "not applicable",
  FINDING: "finding",
});

const ASSESSED = new Set(["AVAILABLE", "PARTIAL"]);
const UNASSESSED = new Set([
  "UNAVAILABLE",
  "FAILED",
  "BLOCKED",
  "NOT_CONNECTED",
  "NOT_COLLECTED",
]);

const LEGACY_KEYS = [
  "offerClarity",
  "ctaClarity",
  "conversionPathClarity",
  "trustProof",
  "mobileUsability",
  "indexability",
];

const TRUTH_KEYS = [
  "offerClarity",
  "ctaClarity",
  "conversionPathClarity",
  "buyerQuestionCoverage",
  "trustProof",
  "performanceReadiness",
  "indexability",
  "evidenceScope",
];

const statusOf = (value) =>
  typeof value === "string"
    ? value.trim().toUpperCase()
    : null;

const cap = (capabilities, key) =>
  capabilities?.[key] &&
  typeof capabilities[key] === "object"
    ? capabilities[key]
    : null;

const capStatus = (capabilities, key) =>
  statusOf(cap(capabilities, key)?.status);

const hasCaps = (capabilities) =>
  Boolean(
    capabilities &&
    typeof capabilities === "object" &&
    Object.keys(capabilities).length,
  );

const numeric = (value) =>
  typeof value === "number" &&
  Number.isFinite(value)
    ? value
    : null;

function scopeOf(value, fallback) {
  const requested =
    value?.coverage?.requested;

  const completed =
    value?.coverage?.completed;

  return (
    Number.isFinite(requested) &&
    requested > 0 &&
    Number.isFinite(completed)
  )
    ? `${completed} of ${requested} requested page(s)`
    : fallback;
}

function truth({
  state,
  scope,
  observation,
  clientConclusion,
  qualifier = null,
  prohibitedUpgrades = [],
  evidenceRefs = [],
  businessMeaning = null,
  recommendedAction = null,
}) {
  return Object.freeze({
    state,
    scope,
    observation,
    clientConclusion,
    qualifier,
    prohibitedUpgrades:
      Object.freeze([
        ...prohibitedUpgrades,
      ]),
    evidenceRefs:
      Object.freeze([
        ...evidenceRefs,
      ]),
    businessMeaning,
    recommendedAction,
  });
}

function unavailable(
  scope,
  observation,
  refs,
  prohibited,
  meaning,
  qualifier = null,
) {
  return truth({
    state:
      CLIENT_TRUTH_STATE.NOT_ASSESSED,
    scope,
    observation,
    clientConclusion:
      "We did not have enough evidence to determine this. No positive or negative site conclusion is made.",
    qualifier:
      qualifier ||
      "This is an evidence limitation, not a finding about the website.",
    prohibitedUpgrades:
      prohibited,
    evidenceRefs:
      refs,
    businessMeaning:
      meaning,
  });
}

function notApplicable(
  scope,
  label,
  refs,
  prohibited,
  meaning,
) {
  return truth({
    state:
      CLIENT_TRUTH_STATE.NOT_APPLICABLE,
    scope,
    observation:
      `${label} assessment was affirmatively classified as not applicable.`,
    clientConclusion:
      `${label} assessment was not applicable.`,
    prohibitedUpgrades:
      prohibited,
    evidenceRefs:
      refs,
    businessMeaning:
      meaning,
  });
}

function capabilityTruth({
  capabilities,
  key,
  label,
  scope,
  present,
  observationPresent,
  observationAbsent,
  conclusionPresent,
  conclusionAbsent,
  refs,
  prohibited,
  meaning,
}) {
  const value =
    cap(capabilities, key);

  const status =
    statusOf(value?.status);

  const boundedScope =
    scopeOf(value, scope);

  if (
    status ===
    "NOT_APPLICABLE"
  ) {
    return notApplicable(
      boundedScope,
      label,
      refs,
      prohibited,
      meaning,
    );
  }

  if (
    !ASSESSED.has(status)
  ) {
    return unavailable(
      boundedScope,
      `${label} evidence was not available for assessment.`,
      refs,
      prohibited,
      meaning,
    );
  }

  const partial =
    status === "PARTIAL";

  return truth({
    state:
      partial
        ? CLIENT_TRUTH_STATE.PARTIAL
        : present
          ? CLIENT_TRUTH_STATE.ASSESSED
          : CLIENT_TRUTH_STATE.FINDING,
    scope:
      boundedScope,
    observation:
      present
        ? observationPresent
        : observationAbsent,
    clientConclusion:
      present
        ? conclusionPresent
        : conclusionAbsent,
    qualifier:
      partial
        ? "The conclusion is limited to the assessed scope."
        : null,
    prohibitedUpgrades:
      prohibited,
    evidenceRefs:
      refs,
    businessMeaning:
      meaning,
  });
}

function buildOfferTruth(
  site,
  capabilities,
) {
  const services =
    Array.isArray(site?.services)
      ? site.services.filter(Boolean)
      : [];

  return capabilityTruth({
    capabilities,
    key:
      "offer.clarity",
    label:
      "Offer clarity",
    scope:
      "the assessed commercial pages",
    present:
      services.length > 0,
    observationPresent:
      `Service or offer scope was observed for ${services.length} item(s) in the assessed evidence.`,
    observationAbsent:
      "No explicit service or offer scope was detected in the assessed evidence.",
    conclusionPresent:
      "Service or offer scope was observed in the assessed scope.",
    conclusionAbsent:
      "No explicit service or offer scope was detected in the assessed scope.",
    refs: [
      "site.services",
      "capabilityEvidence.capabilities.offer.clarity",
    ],
    prohibited: [
      "the offer is clear to all buyers",
      "the offer is unclear site-wide",
      "observed service scope proves buyer comprehension",
    ],
    meaning:
      "Observed service scope does not by itself prove buyer comprehension.",
  });
}

function buildCtaTruth(
  site,
  capabilities,
) {
  const value =
    cap(
      capabilities,
      "conversion.cta",
    );

  const present =
    (
      Array.isArray(site?.ctas) &&
      site.ctas.length > 0
    ) ||
    (
      value
        ?.browserSummary
        ?.presentPages ??
      0
    ) > 0;

  return capabilityTruth({
    capabilities,
    key:
      "conversion.cta",
    label:
      "CTA",
    scope:
      "the assessed conversion pages",
    present,
    observationPresent:
      "A call to action was observed in the assessed scope.",
    observationAbsent:
      "No call to action was observed in the assessed scope.",
    conclusionPresent:
      "A conversion invitation exists in the assessed scope.",
    conclusionAbsent:
      "No conversion invitation was detected in the assessed scope.",
    refs: [
      "site.ctas",
      "capabilityEvidence.capabilities.conversion.cta",
    ],
    prohibited: [
      "CTA presence proves the conversion path is usable or effective",
      "CTA presence proves conversion readiness",
      "CTA exists site-wide",
      "CTA is absent site-wide",
    ],
    meaning:
      "A visible invitation is not the same as a complete or usable conversion path.",
  });
}

function buildPathTruth(
  conversionPaths,
  capabilities,
) {
  const value =
    cap(
      capabilities,
      "conversion.path",
    );

  const status =
    statusOf(value?.status);

  const scope =
    scopeOf(
      value,
      "the assessed conversion path(s)",
    );

  const refs = [
    "conversionPaths[].status",
    "capabilityEvidence.capabilities.conversion.path",
  ];

  const prohibited = [
    "conversion path is working",
    "conversion path is strong",
    "conversion path is adequate",
    "CTA or form presence proves path effectiveness",
  ];

  if (
    status ===
    "NOT_APPLICABLE"
  ) {
    return notApplicable(
      scope,
      "Conversion path",
      refs,
      prohibited,
      "No path-quality conclusion follows from a not-applicable state.",
    );
  }

  if (
    !ASSESSED.has(status)
  ) {
    return unavailable(
      scope,
      "A complete conversion path was not assessed.",
      refs,
      prohibited,
      "Path quality cannot be inferred from CTA or form presence alone.",
    );
  }

  const statuses =
    (
      Array.isArray(
        conversionPaths,
      )
        ? conversionPaths
        : []
    )
      .map(
        (path) =>
          String(
            path?.status ||
            "",
          ).trim(),
      )
      .filter(Boolean);

  if (
    !statuses.length ||
    statuses.every(
      (item) =>
        /^not assessed$/i.test(
          item,
        ),
    )
  ) {
    return unavailable(
      scope,
      "A complete conversion path was not assessed.",
      refs,
      prohibited,
      "Path quality cannot be inferred from CTA or form presence alone.",
    );
  }

  const clear =
    statuses.filter(
      (item) =>
        /^clear$/i.test(item),
    ).length;

  const weak =
    statuses.filter(
      (item) =>
        /^(weak|missing|missing support)$/i.test(
          item,
        ),
    ).length;

  const partial =
    status === "PARTIAL" ||
    clear + weak <
      statuses.length;

  if (weak > 0) {
    return truth({
      state:
        partial
          ? CLIENT_TRUTH_STATE.PARTIAL
          : CLIENT_TRUTH_STATE.FINDING,
      scope,
      observation:
        "At least one assessed conversion path was weak, missing, or missing support.",
      clientConclusion:
        "A conversion mechanism may exist, but the assessed path to complete the action is not clear enough to treat as working end to end.",
      qualifier:
        partial
          ? "The conclusion is limited to the assessed path scope."
          : null,
      prohibitedUpgrades:
        prohibited,
      evidenceRefs:
        refs,
      businessMeaning:
        "Path clarity affects whether a visitor can complete the intended action.",
    });
  }

  return truth({
    state:
      status === "PARTIAL"
        ? CLIENT_TRUTH_STATE.PARTIAL
        : CLIENT_TRUTH_STATE.ASSESSED,
    scope,
    observation:
      "Every assessed conversion path in scope was classified as clear.",
    clientConclusion:
      "The assessed conversion path was clear in the measured scope.",
    qualifier:
      status === "PARTIAL"
        ? "The conclusion is limited to the assessed path scope."
        : null,
    prohibitedUpgrades: [
      "conversion performance is proven",
      "conversion rate is strong",
      "the path is effective for all visitors",
    ],
    evidenceRefs:
      refs,
    businessMeaning:
      "A clear assessed path does not prove conversion rate or visitor effectiveness.",
  });
}

function combinedStatus(
  capabilities,
  keys,
) {
  const statuses =
    keys
      .map(
        (key) =>
          capStatus(
            capabilities,
            key,
          ),
      )
      .filter(Boolean);

  if (!statuses.length) {
    return null;
  }

  if (
    statuses.every(
      (item) =>
        item ===
        "NOT_APPLICABLE",
    )
  ) {
    return "NOT_APPLICABLE";
  }

  if (
    statuses.some(
      (item) =>
        UNASSESSED.has(item),
    )
  ) {
    return "UNAVAILABLE";
  }

  if (
    statuses.some(
      (item) =>
        item === "PARTIAL",
    )
  ) {
    return "PARTIAL";
  }

  return statuses.every(
    (item) =>
      item === "AVAILABLE",
  )
    ? "AVAILABLE"
    : "UNAVAILABLE";
}

function buildBuyerQuestionTruth(
  site,
  capabilities,
) {
  const status =
    combinedStatus(
      capabilities,
      [
        "content.body",
        "trust.proof",
      ],
    );

  const scope =
    scopeOf(
      cap(
        capabilities,
        "content.body",
      ),
      "the assessed content pages",
    );

  const refs = [
    "site.trust.faq",
    "capabilityEvidence.capabilities.content.body",
    "capabilityEvidence.capabilities.trust.proof",
  ];

  const prohibited = [
    "no buyer-question content exists",
    "buyer questions are not answered",
    "buyer-question coverage is complete",
  ];

  if (
    status ===
    "NOT_APPLICABLE"
  ) {
    return notApplicable(
      scope,
      "FAQ",
      refs,
      prohibited,
      "FAQ applicability does not establish broader buyer-question coverage.",
    );
  }

  if (
    !ASSESSED.has(status) ||
    typeof site
      ?.trust
      ?.faq !== "boolean"
  ) {
    return unavailable(
      scope,
      "Explicit FAQ coverage could not be determined from the available evidence.",
      refs,
      prohibited,
      "FAQ evidence cannot establish all buyer-question coverage.",
    );
  }

  const faq =
    site.trust.faq;

  return truth({
    state:
      status === "PARTIAL"
        ? CLIENT_TRUTH_STATE.PARTIAL
        : faq
          ? CLIENT_TRUTH_STATE.ASSESSED
          : CLIENT_TRUTH_STATE.FINDING,
    scope,
    observation:
      faq
        ? "Explicit FAQ content was detected in the assessed scope."
        : "No explicit FAQ content was detected in the assessed scope.",
    clientConclusion:
      faq
        ? "Explicit FAQ content was observed on the assessed page(s)."
        : "No explicit FAQ content was detected on the assessed page(s).",
    qualifier:
      status === "PARTIAL"
        ? "The conclusion is limited to the assessed page scope."
        : null,
    prohibitedUpgrades:
      prohibited,
    evidenceRefs:
      refs,
    businessMeaning:
      "FAQ presence is one form of buyer-question support; it does not measure all buyer-question coverage.",
  });
}

function buildTrustTruth(
  site,
  capabilities,
) {
  const trust =
    site?.trust || {};

  const observed =
    [
      trust.credentials,
      trust.testimonials,
      trust.caseStudies,
      trust.policies,
      trust.contact,
    ].some(
      (value) =>
        value === true,
    );

  return capabilityTruth({
    capabilities,
    key:
      "trust.proof",
    label:
      "Trust proof",
    scope:
      "the assessed trust-proof scope",
    present:
      observed,
    observationPresent:
      "Trust proof was observed in the assessed scope.",
    observationAbsent:
      "No trust-proof asset was detected in the assessed scope.",
    conclusionPresent:
      "Trust proof was observed in the assessed scope.",
    conclusionAbsent:
      "No trust proof was detected in the assessed scope.",
    refs: [
      "site.trust",
      "capabilityEvidence.capabilities.trust.proof",
    ],
    prohibited: [
      "trust proof is underused",
      "trust proof is poorly placed",
      "trust proof is effective",
      "trust proof is ineffective",
    ],
    meaning:
      "Observed proof does not establish placement, use, or effectiveness.",
  });
}

function buildPerformanceTruth(
  performance,
  scores,
  capabilities,
) {
  const labStatus =
    capStatus(
      capabilities,
      "performance.lab",
    );

  const fieldStatus =
    capStatus(
      capabilities,
      "performance.field",
    );

  const scope =
    scopeOf(
      cap(
        capabilities,
        "performance.lab",
      ),
      "the available lab performance sample",
    );

  const refs = [
    "performance.mobile.scores.performance",
    "performance.desktop.scores.performance",
    "scores.performance",
    "capabilityEvidence.capabilities.performance.lab",
    "capabilityEvidence.capabilities.performance.field",
  ];

  const mobile =
    numeric(
      performance
        ?.mobile
        ?.scores
        ?.performance,
    );

  const desktop =
    numeric(
      performance
        ?.desktop
        ?.scores
        ?.performance,
    );

  const aggregate =
    numeric(
      scores?.performance,
    );

  if (
    labStatus ===
      "NOT_APPLICABLE" &&
    fieldStatus ===
      "NOT_APPLICABLE"
  ) {
    return notApplicable(
      scope,
      "Performance",
      refs,
      [
        "performance PASS",
        "performance FAIL",
      ],
      "No performance conclusion follows from a not-applicable state.",
    );
  }

  if (
    !ASSESSED.has(
      labStatus,
    )
  ) {
    return unavailable(
      scope,
      "Usable lab performance evidence was not available for assessment.",
      refs,
      [
        "performance PASS",
        "performance is already working",
        "real-user performance is strong",
        "no performance action is required",
      ],
      "Performance readiness cannot be established without the required measurement evidence.",
    );
  }

  const measured = [];

  if (
    desktop !== null
  ) {
    measured.push(
      `desktop lab score ${desktop}`,
    );
  }

  if (
    mobile !== null
  ) {
    measured.push(
      `mobile lab score ${mobile}`,
    );
  }

  if (
    !measured.length &&
    aggregate !== null
  ) {
    measured.push(
      `aggregate lab score ${aggregate}`,
    );
  }

  const observation =
    `Lab performance was measured: ${measured.join("; ")}.`;

  const fieldAssessed =
    ASSESSED.has(
      fieldStatus,
    );

  const qualifier =
    !fieldAssessed
      ? "Real-user field performance was not available; no real-user performance conclusion is made."
      : fieldStatus ===
          "PARTIAL"
        ? "Real-user field performance was only partially available."
        : null;

  return truth({
    state:
      labStatus === "PARTIAL" ||
      fieldStatus === "PARTIAL" ||
      !fieldAssessed
        ? CLIENT_TRUTH_STATE.PARTIAL
        : CLIENT_TRUTH_STATE.ASSESSED,
    scope,
    observation,
    clientConclusion:
      qualifier
        ? `${observation} ${qualifier}`
        : observation,
    qualifier,
    prohibitedUpgrades: [
      "lab performance proves real-user performance",
      ...(
        !fieldAssessed
          ? [
              "performance PASS",
              "performance is already working",
              "real-user performance is strong",
              "no performance action is required",
            ]
          : []
      ),
    ],
    evidenceRefs:
      refs,
    businessMeaning:
      "Lab data does not establish real-user performance.",
  });
}

function buildIndexabilityTruth(
  site,
  capabilities,
) {
  const blocked =
    Array.isArray(
      site?.nonIndexablePages,
    )
      ? site.nonIndexablePages
      : null;

  if (blocked === null) {
    return unavailable(
      "the assessed crawl scope",
      "Page-level indexability evidence was not available for assessment.",
      [
        "site.nonIndexablePages",
      ],
      [
        "site is indexable",
        "site is not indexable",
      ],
      "Indexability conclusions must stay within the pages actually assessed.",
    );
  }

  return capabilityTruth({
    capabilities,
    key:
      "technical.indexability",
    label:
      "Indexability",
    scope:
      "the assessed crawl scope",
    present:
      blocked.length === 0,
    observationPresent:
      "No non-indexable page was identified in the assessed crawl scope.",
    observationAbsent:
      `${blocked.length} assessed page(s) were identified as non-indexable.`,
    conclusionPresent:
      "No non-indexable page was found in the assessed crawl scope.",
    conclusionAbsent:
      `${blocked.length} assessed page(s) were identified as non-indexable.`,
    refs: [
      "site.nonIndexablePages",
      "capabilityEvidence.capabilities.technical.indexability",
    ],
    prohibited: [
      "the entire site is indexable",
      "the entire site is not indexable",
      "no indexability action is required",
    ],
    meaning:
      "Unassessed pages remain unknown.",
  });
}

function buildEvidenceScopeTruth(
  capabilities,
) {
  const entries =
    Object.entries(
      capabilities || {},
    ).filter(
      ([, value]) =>
        value &&
        typeof value ===
          "object",
    );

  const refs = [
    "capabilityEvidence.capabilities",
  ];

  const prohibited = [
    "PASS from unavailable evidence",
    "no blocker from unavailable evidence",
    "no action required from unavailable evidence",
    "absence claim from unavailable evidence",
    "site-wide certainty from partial evidence",
  ];

  if (!entries.length) {
    return unavailable(
      "the governed capability-evidence contract",
      "Capability-level evidence status was not supplied to the client-truth producer.",
      refs,
      prohibited,
      "Evidence status determines how strong a client-facing conclusion may be.",
    );
  }

  const statuses =
    entries.map(
      ([, value]) =>
        statusOf(
          value.status,
        ),
    );

  if (
    statuses.every(
      (item) =>
        item ===
        "NOT_APPLICABLE",
    )
  ) {
    return notApplicable(
      "the governed capability-evidence contract",
      "Capability evidence",
      refs,
      [
        "site PASS",
        "site FAIL",
      ],
      "Not-applicable evidence cannot become a positive or negative site conclusion.",
    );
  }

  const assessed =
    statuses.filter(
      (item) =>
        ASSESSED.has(item),
    ).length;

  const limited =
    entries.filter(
      ([, value]) =>
        statusOf(
          value.status,
        ) === "PARTIAL" ||
        UNASSESSED.has(
          statusOf(
            value.status,
          ),
        ),
    );

  const state =
    !assessed
      ? CLIENT_TRUTH_STATE.NOT_ASSESSED
      : limited.length
        ? CLIENT_TRUTH_STATE.PARTIAL
        : CLIENT_TRUTH_STATE.ASSESSED;

  return truth({
    state,
    scope:
      `${entries.length} governed capability check(s)`,
    observation:
      limited.length
        ? `Evidence limitations were recorded for: ${limited
            .map(
              ([key, value]) =>
                `${key}:${statusOf(value.status)}`,
            )
            .join(", ")}.`
        : "No partial or unavailable status was recorded in the supplied capability checks.",
    clientConclusion:
      state ===
      CLIENT_TRUTH_STATE.ASSESSED
        ? "The supplied governed capability checks were available for the assessed scope."
        : state ===
            CLIENT_TRUTH_STATE.PARTIAL
          ? "Some governed evidence was partial or unavailable; conclusions must stay within the assessed scope."
          : "The supplied governed capability checks did not provide enough assessed evidence for a site conclusion.",
    qualifier:
      state ===
      CLIENT_TRUTH_STATE.ASSESSED
        ? null
        : "Unavailable, failed, blocked, not-connected, or partial evidence must not be upgraded into complete certainty.",
    prohibitedUpgrades:
      prohibited,
    evidenceRefs:
      refs,
    businessMeaning:
      "Evidence gaps limit the strength and scope of client-facing conclusions.",
  });
}

function legacyConstructs({
  site,
  performance,
  scores,
  bands,
  conversionPaths,
  capabilities,
}) {
  const paths =
    Array.isArray(
      conversionPaths,
    )
      ? conversionPaths
      : [];

  const clear =
    paths.filter(
      (path) =>
        path?.status ===
        "Clear",
    ).length;

  const weak =
    paths.filter(
      (path) =>
        path?.status ===
        "Weak",
    ).length;

  const pathStatus =
    capStatus(
      capabilities,
      "conversion.path",
    );

  const conversionPathClarity =
    hasCaps(capabilities) &&
    !ASSESSED.has(pathStatus)
      ? "Not Assessed"
      : !paths.length
        ? "Not Assessed"
        : clear ===
            paths.length
          ? "Clear"
          : weak
            ? "Weak"
            : "Partial";

  const ctas =
    Array.isArray(
      site?.ctas,
    )
      ? site.ctas
      : [];

  const ctaStatus =
    capStatus(
      capabilities,
      "conversion.cta",
    );

  const ctaClarity =
    hasCaps(capabilities) &&
    !ASSESSED.has(ctaStatus)
      ? "Not Assessed"
      : !ctas.length
        ? "No CTA observed"
        : ctas.some(
              (cta) =>
                !String(
                  cta?.text ||
                  "",
                ).trim() ||
                !String(
                  cta?.url ||
                  "",
                ).trim(),
            )
          ? "Partial"
          : "Clear";

  const offerStatus =
    capStatus(
      capabilities,
      "offer.clarity",
    );

  const offerClarity =
    hasCaps(capabilities) &&
    !ASSESSED.has(
      offerStatus,
    )
      ? "Not Assessed"
      : Array.isArray(
            site?.services,
          ) &&
          site.services.length
        ? "Observed service scope"
        : "Not Assessed";

  const trustStatus =
    capStatus(
      capabilities,
      "trust.proof",
    );

  const trustProof =
    hasCaps(capabilities) &&
    !ASSESSED.has(
      trustStatus,
    )
      ? "Not Assessed"
      : bands?.trust ||
        "Not Assessed";

  const labStatus =
    capStatus(
      capabilities,
      "performance.lab",
    );

  const mobile =
    numeric(
      performance
        ?.mobile
        ?.scores
        ?.performance,
    ) ??
    numeric(
      scores?.performance,
    );

  const mobileUsability =
    hasCaps(capabilities) &&
    !ASSESSED.has(
      labStatus,
    )
      ? "Not Assessed"
      : mobile === null
        ? "Not Assessed"
        : mobile >= 70
          ? "Strong"
          : "Needs attention";

  const indexStatus =
    capStatus(
      capabilities,
      "technical.indexability",
    );

  const indexability =
    hasCaps(capabilities) &&
    !ASSESSED.has(
      indexStatus,
    )
      ? "Not Assessed"
      : !Array.isArray(
            site
              ?.nonIndexablePages,
          )
        ? "Not Assessed"
        : site
            .nonIndexablePages
            .length
          ? "Needs attention"
          : "Strong";

  return Object.freeze({
    offerClarity,
    ctaClarity,
    conversionPathClarity,
    trustProof,
    mobileUsability,
    indexability,
  });
}

const LINEAGE =
  Object.freeze({
    offerClarity:
      "site.services + capabilityEvidence.capabilities.offer.clarity",
    ctaClarity:
      "site.ctas + capabilityEvidence.capabilities.conversion.cta",
    conversionPathClarity:
      "conversionPaths[].status + capabilityEvidence.capabilities.conversion.path",
    buyerQuestionCoverage:
      "site.trust.faq + capabilityEvidence.capabilities.content.body + capabilityEvidence.capabilities.trust.proof",
    trustProof:
      "site.trust + capabilityEvidence.capabilities.trust.proof",
    performanceReadiness:
      "performance lab + capabilityEvidence performance.lab/performance.field",
    mobileUsability:
      "performance.mobile.scores.performance + capabilityEvidence.capabilities.performance.lab",
    indexability:
      "site.nonIndexablePages + capabilityEvidence.capabilities.technical.indexability",
    evidenceScope:
      "capabilityEvidence.capabilities",
  });

export function buildCrossReportInterpretation({
  site = {},
  performance = null,
  scores = {},
  bands = {},
  conversionPaths = [],
  capabilities = {},
} = {}) {
  return Object.freeze({
    version:
      CLIENT_TRUTH_VERSION,
    contract:
      "CLIENT_TRUTH",

    constructs:
      legacyConstructs({
        site,
        performance,
        scores,
        bands,
        conversionPaths,
        capabilities,
      }),

    truth:
      Object.freeze({
        offerClarity:
          buildOfferTruth(
            site,
            capabilities,
          ),

        ctaClarity:
          buildCtaTruth(
            site,
            capabilities,
          ),

        conversionPathClarity:
          buildPathTruth(
            conversionPaths,
            capabilities,
          ),

        buyerQuestionCoverage:
          buildBuyerQuestionTruth(
            site,
            capabilities,
          ),

        trustProof:
          buildTrustTruth(
            site,
            capabilities,
          ),

        performanceReadiness:
          buildPerformanceTruth(
            performance,
            scores,
            capabilities,
          ),

        indexability:
          buildIndexabilityTruth(
            site,
            capabilities,
          ),

        evidenceScope:
          buildEvidenceScopeTruth(
            capabilities,
          ),
      }),

    actions:
      Object.freeze([]),

    lineage:
      LINEAGE,
  });
}

function requireProjection(
  projection,
) {
  if (
    !projection ||
    ![
      "1.0.0",
      CLIENT_TRUTH_VERSION,
    ].includes(
      projection.version,
    ) ||
    !projection.constructs ||
    LEGACY_KEYS.some(
      (key) =>
        typeof projection
          .constructs[key] !==
        "string",
    )
  ) {
    throw new Error(
      "Current report model requires persisted cross-report interpretation",
    );
  }

  return projection;
}

export function requireCrossReportInterpretation(
  model,
) {
  return requireProjection(
    model
      ?.crossReportInterpretation,
  );
}

export function requireClientTruth(
  model,
) {
  const projection =
    requireProjection(
      model
        ?.crossReportInterpretation,
    );

  if (
    projection.version !==
      CLIENT_TRUTH_VERSION ||
    projection.contract !==
      "CLIENT_TRUTH" ||
    !projection.truth ||
    TRUTH_KEYS.some(
      (key) => {
        const value =
          projection
            .truth[key];

        return (
          !value ||
          typeof value !==
            "object" ||
          typeof value.state !==
            "string" ||
          typeof value.scope !==
            "string" ||
          typeof value
            .observation !==
            "string" ||
          typeof value
            .clientConclusion !==
            "string" ||
          !Array.isArray(
            value
              .prohibitedUpgrades,
          ) ||
          !Array.isArray(
            value
              .evidenceRefs,
          )
        );
      },
    )
  ) {
    throw new Error(
      "Current client-facing consumer requires Client Truth Contract v2.0.0",
    );
  }

  return projection;
}

export function attachClientTruthActions(
  projection,
  actions = [],
) {
  const verified =
    requireClientTruth({
      crossReportInterpretation:
        projection,
    });

  const normalized =
    (
      Array.isArray(actions)
        ? actions
        : []
    ).map(
      (action) => {
        const finding =
          action?.finding ||
          {};

        const value =
          Object.freeze({
            findingId:
              action
                ?.findingId ||
              finding
                ?.findingId ||
              null,

            ruleId:
              action?.ruleId ||
              finding?.ruleId ||
              null,

            rank:
              action?.rank,

            group:
              action?.group ||
              null,

            impactLabel:
              action
                ?.impactLabel ||
              null,

            businessReason:
              action
                ?.businessReason ||
              null,

            recommendation:
              action
                ?.recommendation ||
              finding
                ?.recommendation ||
              null,

            verificationMethod:
              action
                ?.verificationMethod ||
              finding
                ?.verificationMethod ||
              null,
          });

        if (
          !value.findingId ||
          !value.ruleId ||
          !Number.isInteger(
            value.rank,
          ) ||
          value.rank < 1 ||
          !value.group ||
          !value.impactLabel ||
          !value.businessReason
        ) {
          throw new Error(
            "Client Truth action requires findingId, ruleId, rank, group, impactLabel, and businessReason",
          );
        }

        return value;
      },
    );

  return Object.freeze({
    ...verified,
    actions:
      Object.freeze(
        normalized,
      ),
  });
}