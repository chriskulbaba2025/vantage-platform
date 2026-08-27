/**
 * PRYSM-NEXT-01 WP-C — Capability Evidence v2
 *
 * Versioned capability-level evidence layer. Derives an explicit status
 * (AVAILABLE / PARTIAL / UNAVAILABLE / FAILED / NOT_CONNECTED / NOT_APPLICABLE)
 * per capability from the governed decision evidence, with coverage,
 * provenance, and limitations.
 *
 * Governing rule (CRIT #8/#9): unknown data is NEVER converted into
 * false / 0 / [] / {} on score-bearing paths. Capability statuses are
 * derived from explicit evidence markers only:
 *   - `site._contentEvidenceAvailable === true`  → body content collected
 *   - `site._contentEvidenceAvailable === false` → provider did NOT return
 *     body content (DataForSEO pages endpoint metadata-only)
 *   - `undefined` → unknown (absent), never treated as confirmed-absent
 *
 * This module does NOT call providers, fabricate data, or score.
 */

import { createHash } from "node:crypto";
import { buildArtifactKey } from "../storage/artifact-key.js";

export const CAPABILITY_EVIDENCE_VERSION = "2.0.0";

const CAPABILITY_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  PARTIAL: "PARTIAL",
  UNAVAILABLE: "UNAVAILABLE",
  FAILED: "FAILED",
  NOT_CONNECTED: "NOT_CONNECTED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

// All score-bearing capabilities in the upgraded product (WP-D consumes).
export const CAPABILITIES = Object.freeze([
  "content.body",
  "offer.clarity",
  "trust.proof",
  "conversion.cta",
  "conversion.form",
  "conversion.path",
  "technical.indexability",
  "technical.redirects",
  "technical.resources",
  "technical.headers",
  "schema.structured_data",
  "performance.lab",
  "performance.field",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function capability({
  capability: name,
  status,
  coverage = { requested: null, completed: null, failed: null },
  provenance = { source: null, adapterVersion: null, artifactRef: null },
  limitations = [],
  requiredFieldsPresent = false,
  extra = {},
}) {
  return {
    capability: name,
    status,
    coverage,
    provenance,
    limitations,
    requiredFieldsPresent,
    ...extra,
  };
}

const SITE_SOURCE = "dataforseo-onpage";
const PERF_SOURCE = "pagespeed";

function isArray(value) {
  return Array.isArray(value);
}

/**
 * Content evidence discriminator — strict, never coerces unknown.
 * Returns "available" | "unavailable" | "unknown".
 */
function contentEvidenceState(site) {
  const marker = site?._contentEvidenceAvailable;
  if (marker === true) return "available";
  if (marker === false) return "unavailable";
  return "unknown";
}

function siteProvenance(site) {
  return {
    source: SITE_SOURCE,
    adapterVersion: site?.adapterVersion ?? null,
    artifactRef: site?.rawArtifactRef ?? null,
  };
}

/** Acquisition ledger entry with safe defaults (never fabricated). */
function acquisitionOf(site, key) {
  const acq = site?.acquisition;
  if (!acq || typeof acq !== "object") return null;
  const entry = acq[key];
  if (!entry || typeof entry !== "object") return null;
  return entry;
}
function governedDeepCoverageIncomplete(site) {
  const entry = acquisitionOf(
    site,
    "contentParsing",
  );

  // Legacy artifacts did not contain the governed URL-aware ledger.
  // Preserve their existing interpretation instead of assuming
  // incomplete coverage.
  if (
    !entry ||
    !Array.isArray(entry.selectedUrls)
  ) {
    return false;
  }

  const selectedCount =
    entry.selectedUrls.length;

  if (selectedCount === 0) {
    return false;
  }

  const completedCount =
    Array.isArray(entry.completedUrls)
      ? entry.completedUrls.length
      : 0;

  const failedCount =
    Array.isArray(entry.failedUrls)
      ? entry.failedUrls.length
      : Number(entry.failed || 0);

  const unassessedCount =
    Array.isArray(entry.unassessedUrls)
      ? entry.unassessedUrls.length
      : 0;

  return (
    completedCount !== selectedCount ||
    failedCount > 0 ||
    unassessedCount > 0
  );
}

function coverageFromAcq(entry) {
  if (!entry) return { requested: null, completed: null, failed: null };
  return {
    requested: typeof entry.requested === "number" ? entry.requested : null,
    completed: typeof entry.completed === "number" ? entry.completed : null,
    failed: typeof entry.failed === "number" ? entry.failed : null,
  };
}

/**
 * Per-capability derivation rules. Each rule returns a capability record.
 * Deterministic: only the decision evidence is consumed.
 */
function deriveCapabilities(evidence, auditId, pathValidationEvidence) {
  const site = evidence?.site;
  const performance = evidence?.performance;
  const contentState = contentEvidenceState(site);
  const siteProv = siteProvenance(site);
  const caps = {};

  // ── content.body ─────────────────────────────────────────────────────
  {
    const cpAcq = acquisitionOf(site, "contentParsing");
    const cp = isArray(site?.contentParsing) ? site.contentParsing : [];

    // Request completion proves transport/execution only. It does not prove
    // that usable body-content evidence was returned. Count a record as usable
    // only when at least one substantive content field was actually collected.
    const usableContentRecords = cp.filter((record) => {
      const hasText =
        typeof record?.text === "string" &&
        record.text.trim().length > 0;

      const hasWordCount =
        typeof record?.wordCount === "number" &&
        Number.isFinite(record.wordCount);

      const hasMainContentChars =
        typeof record?.mainContentChars === "number" &&
        Number.isFinite(record.mainContentChars);

      return hasText || hasWordCount || hasMainContentChars;
    });

    const usableCompleted = usableContentRecords.length;

    const cpCoverage =
      cpAcq &&
      typeof cpAcq.requested === "number"
        ? {
            requested: cpAcq.requested,
            completed: usableCompleted,
            failed: Math.max(0, cpAcq.requested - usableCompleted),
          }
        : coverageFromAcq(cpAcq);

    let status;
    const limitations = [];
    let requiredFields = false;

    if (
      cpAcq &&
      typeof cpAcq.requested === "number" &&
      cpAcq.requested > 0
    ) {
      if (
        usableCompleted === cpAcq.requested &&
        (cpAcq.failed ?? 0) === 0
      ) {
        status = CAPABILITY_STATUS.AVAILABLE;
        requiredFields = true;
      } else if (usableCompleted > 0) {
        status = CAPABILITY_STATUS.PARTIAL;
        requiredFields = true;
        limitations.push(
          `Usable body content returned for ${usableCompleted} of ${cpAcq.requested} requested pages`,
        );
      } else {
        status = CAPABILITY_STATUS.UNAVAILABLE;
        limitations.push(
          "Content parsing requests completed but returned no usable body-content fields",
        );
      }
    } else if (contentState === "available") {
      status = CAPABILITY_STATUS.AVAILABLE;
      requiredFields = true;
    } else if (contentState === "unavailable") {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push(
        "Provider pages endpoint returned no page body content (metadata-only crawl)",
      );
    } else {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push("Page body content evidence was not collected");
    }

 if (
  governedDeepCoverageIncomplete(site) &&
  status !== CAPABILITY_STATUS.UNAVAILABLE
) {
  status = CAPABILITY_STATUS.PARTIAL;
  requiredFields = true;

  limitations.push(
    "Governed deep-content coverage is incomplete; conclusions are limited to the assessed representative pages.",
  );
}

    caps["content.body"] = capability({
      capability: "content.body",
      status,
      coverage: cpCoverage,
      provenance: siteProv,
      limitations,
      requiredFieldsPresent: requiredFields,
    });
  }

  // ── offer.clarity / trust.proof — body-content evidence ──────────────
  const contentDependent = [
    [
      "offer.clarity",
      "Offer clarity requires body-content evidence (services, CTAs, forms, descriptions)",
    ],
    [
      "trust.proof",
      "Trust proof requires body-content evidence (credentials, testimonials, policies)",
    ],
  ];

  for (const [name, limitation] of contentDependent) {
    let status;
    const limitations = [];

    if (contentState === "available") {
  if (governedDeepCoverageIncomplete(site)) {
    status = CAPABILITY_STATUS.PARTIAL;
    limitations.push(
      "Governed deep-content coverage is incomplete; conclusions are limited to the assessed representative pages.",
    );
  } else {
    status = CAPABILITY_STATUS.AVAILABLE;
  }
} else {
  status = CAPABILITY_STATUS.UNAVAILABLE;
  limitations.push(limitation);
}

caps[name] = capability({
  capability: name,
  status,
  coverage: {
    requested: null,
    completed: null,
    failed: null,
  },
  provenance: siteProv,
  limitations,
  requiredFieldsPresent:
    status === CAPABILITY_STATUS.AVAILABLE ||
    status === CAPABILITY_STATUS.PARTIAL,
});
  }

   // ── conversion.cta / conversion.form — INTERACTIVE evidence ──────────
  // Parsed text does not prove interactive behavior. Prefer genuine
  // site-level interactive extraction when available; otherwise bridge
  // bounded browser observations into CTA/form capability evidence.
  const interactiveExtracted =
    site?._interactiveEvidenceAvailable !== false;

  const hasCtas =
    isArray(site?.ctas) &&
    site.ctas.length > 0;

  const hasForms =
    isArray(site?.forms) &&
    site.forms.length > 0;

  const browserInteractiveSummary = (kind) => {
    const pages =
      isArray(pathValidationEvidence?.pages)
        ? pathValidationEvidence.pages
        : [];

    const requested =
      typeof pathValidationEvidence?.summary?.requested === "number"
        ? pathValidationEvidence.summary.requested
        : pages.length;

    let completed = 0;
    let presentPages = 0;
    let readyPages = 0;

    for (const page of pages) {
      if (
        page?.status !== "PASS" &&
        page?.status !== "PARTIAL" &&
        page?.status !== "FAILED"
      ) {
        continue;
      }

      const observations = [
        page?.checks?.desktop?.[kind],
        page?.checks?.mobile?.[kind],
      ].filter(
        (value) =>
          value &&
          typeof value === "object",
      );

      let definitive = false;
      let present = false;
      let ready = false;

      for (const observation of observations) {
        if (kind === "cta") {
          if (observation.found === false) {
            definitive = true;
            continue;
          }

          if (observation.found !== true) {
            continue;
          }

          present = true;

          const observationReady =
            observation.visible === true &&
            observation.interactable === true &&
            observation.obstructed === false;

          const observationFailed =
            observation.visible === false ||
            observation.interactable === false ||
            observation.obstructed === true;

          if (
            observationReady ||
            observationFailed
          ) {
            definitive = true;
          }

          if (observationReady) {
            ready = true;
          }
        } else {
          if (observation.found === false) {
            definitive = true;
            continue;
          }

          if (
            observation.found !== true ||
            observation.limitation
          ) {
            continue;
          }

          present = true;

          const observationReady =
            observation.fieldsEditable === true &&
            observation.submitEnabled === true;

          const observationFailed =
            observation.fieldsEditable === false ||
            observation.submitEnabled === false;

          if (
            observationReady ||
            observationFailed
          ) {
            definitive = true;
          }

          if (observationReady) {
            ready = true;
          }
        }
      }

      if (!definitive) {
        continue;
      }

      completed += 1;

      if (present) {
        presentPages += 1;
      }

      if (ready) {
        readyPages += 1;
      }
    }

    return {
      requested: Math.max(
        requested,
        completed,
      ),
      completed,
      unassessed: Math.max(
        0,
        requested - completed,
      ),
      presentPages,
      readyPages,
    };
  };

  const browserCtaSummary =
    browserInteractiveSummary("cta");

  const browserFormSummary =
    browserInteractiveSummary("form");

  const interactiveCapabilities = [
    {
      name: "conversion.cta",
      present: hasCtas,
      browserSummary: browserCtaSummary,
      limitation:
        "CTA evidence was not extracted from the pages endpoint (parsed text does not prove CTA absence)",
      browserLabel: "CTA",
    },
    {
      name: "conversion.form",
      present: hasForms,
      browserSummary: browserFormSummary,
      limitation:
        "Form evidence was not extracted from the pages endpoint (parsed text does not prove form absence)",
      browserLabel: "form",
    },
  ];

  for (const {
    name,
    present,
    browserSummary,
    limitation,
    browserLabel,
  } of interactiveCapabilities) {
    const limitations = [];

    const siteAssessed =
      contentState === "available" &&
      (present || interactiveExtracted);

    const browserAssessed =
      !siteAssessed &&
      browserSummary.completed > 0;

    let status;

    if (siteAssessed) {
      status =
        CAPABILITY_STATUS.AVAILABLE;
    } else if (browserAssessed) {
      status =
        browserSummary.completed ===
        browserSummary.requested
          ? CAPABILITY_STATUS.AVAILABLE
          : CAPABILITY_STATUS.PARTIAL;

      if (
        browserSummary.completed <
        browserSummary.requested
      ) {
        limitations.push(
          `Browser ${browserLabel} evidence was assessed on ${browserSummary.completed} of ${browserSummary.requested} selected pages; unassessed pages remain unknown`,
        );
      }
    } else if (
      contentState === "available"
    ) {
      status =
        CAPABILITY_STATUS.UNAVAILABLE;

      limitations.push(limitation);

      if (
        isArray(
          pathValidationEvidence?.limitations,
        )
      ) {
        limitations.push(
          ...pathValidationEvidence.limitations,
        );
      }
    } else {
      status =
        CAPABILITY_STATUS.UNAVAILABLE;

      limitations.push(
        "Interactive extraction evidence was not collected",
      );

      if (
        isArray(
          pathValidationEvidence?.limitations,
        )
      ) {
        limitations.push(
          ...pathValidationEvidence.limitations,
        );
      }
    }

    caps[name] = capability({
      capability: name,
      status,
      coverage: browserAssessed
        ? {
            requested:
              browserSummary.requested,
            completed:
              browserSummary.completed,
            failed:
              browserSummary.unassessed,
          }
        : {
            requested: null,
            completed: null,
            failed: null,
          },
      provenance: browserAssessed
        ? {
            source:
              pathValidationEvidence
                ?.provider ||
              "playwright-conversion-path",
            adapterVersion: null,
            artifactRef: null,
          }
        : siteProv,
      limitations,
      requiredFieldsPresent:
        siteAssessed ||
        browserAssessed,
      extra: browserAssessed
        ? {
            validated: true,
            validatedBy:
              pathValidationEvidence
                ?.provider ||
              "playwright-conversion-path",
            browserSummary,
          }
        : {},
    });
  }

  // ── conversion.path (inferred until WP-E validates) ──────────────────
  {
    let status;
    const limitations = [];

    if (
      contentState === "available" &&
      (hasCtas || hasForms)
    ) {
      status = CAPABILITY_STATUS.AVAILABLE;
    } else if (
      contentState === "available" &&
      interactiveExtracted
    ) {
      status = CAPABILITY_STATUS.AVAILABLE;
      limitations.push(
        "No CTA or form evidence found — conversion path may be indirect",
      );
    } else if (contentState === "available") {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push(
        "Conversion path evidence was not extracted (parsed text does not prove path absence)",
      );
    } else {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push(
        "Conversion path evidence was not collected",
      );
    }

    // PRYSM-NEXT-01 WP-E — Playwright validation upgrades the capability
    // from inferred to validated. Browser-level NOT_ASSESSED keeps the
    // inferred state (validation unavailability is never a penalty).
    let kind = "inferred";
    let validated = false;
    let validatedBy = null;
    let validationSummary = null;
    let coverage = {
      requested: null,
      completed: null,
      failed: null,
    };

    if (
      pathValidationEvidence &&
      typeof pathValidationEvidence === "object"
    ) {
      const pages = isArray(pathValidationEvidence.pages)
        ? pathValidationEvidence.pages
        : [];

      const assessed = pages.filter(
        (p) =>
          p?.status === "PASS" ||
          p?.status === "PARTIAL" ||
          p?.status === "FAILED",
      );

      if (assessed.length > 0) {
        kind = "validated";
        validated = true;
        validatedBy =
          pathValidationEvidence.provider ||
          "playwright-conversion-path";

        validationSummary = {
          requested:
            pathValidationEvidence.summary?.requested ??
            pages.length,
          pass:
            pathValidationEvidence.summary?.pass ?? 0,
          partial:
            pathValidationEvidence.summary?.partial ?? 0,
          failed:
            pathValidationEvidence.summary?.failed ?? 0,
          notAssessed:
            pathValidationEvidence.summary?.notAssessed ?? 0,
          obstructionCount: pages.filter(
            (p) =>
              p?.checks?.desktop?.cta?.obstructed === true ||
              p?.checks?.mobile?.cta?.obstructed === true,
          ).length,
        };

        if (
          validationSummary.pass > 0 ||
          validationSummary.partial > 0
        ) {
          status = CAPABILITY_STATUS.AVAILABLE;
        } else {
          // All assessed pages FAILED — collected evidence of broken paths.
          status = CAPABILITY_STATUS.AVAILABLE;
          limitations.push(
            "Validated conversion paths failed their checks",
          );
        }

        coverage = {
          requested: validationSummary.requested,
          completed:
            validationSummary.pass +
            validationSummary.partial +
            validationSummary.failed,
          failed: validationSummary.notAssessed,
        };
      } else if (
        isArray(pathValidationEvidence.limitations) &&
        pathValidationEvidence.limitations.length
      ) {
        limitations.push(
          ...pathValidationEvidence.limitations,
        );
      }
    }

    caps["conversion.path"] = capability({
      capability: "conversion.path",
      status,
      coverage,
      provenance: siteProv,
      limitations,
      requiredFieldsPresent:
        contentState === "available" || validated,
      extra: {
        kind,
        validated,
        validatedBy,
        validationSummary,
      },
    });
  }

  // ── technical.indexability ───────────────────────────────────────────
  {
    const niAcq =
      acquisitionOf(site, "nonIndexable");

    const niCoverage =
      coverageFromAcq(niAcq);

    let status;
    const limitations = [];
    let requiredFields = false;

    if (
      niAcq &&
      typeof niAcq.requested === "number" &&
      niAcq.requested > 0
    ) {
      if ((niAcq.failed ?? 0) === 0) {
        status = CAPABILITY_STATUS.AVAILABLE;
        requiredFields = true;
      } else {
        status = CAPABILITY_STATUS.PARTIAL;
        limitations.push(
          "Non-indexable retrieval was partially unsuccessful",
        );
      }
    } else if (
      isArray(site?.pages) &&
      site.pages.some(
        (p) => typeof p?.indexable === "boolean",
      )
    ) {
      status = CAPABILITY_STATUS.PARTIAL;
      limitations.push(
        "Page-level indexable flags only — non-indexable endpoint not collected",
      );
    } else {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push(
        "Indexability evidence was not collected",
      );
    }

    caps["technical.indexability"] = capability({
      capability: "technical.indexability",
      status,
      coverage: niCoverage,
      provenance: siteProv,
      limitations,
      requiredFieldsPresent: requiredFields,
    });
  }

  // ── technical.redirects ──────────────────────────────────────────────
  {
    const rcAcq =
      acquisitionOf(site, "redirectChains");

    const rcCoverage =
      coverageFromAcq(rcAcq);

    let status;
    const limitations = [];
    let requiredFields = false;

    if (
      rcAcq &&
      typeof rcAcq.requested === "number" &&
      rcAcq.requested > 0
    ) {
      if ((rcAcq.failed ?? 0) === 0) {
        status = CAPABILITY_STATUS.AVAILABLE;
        requiredFields = true;
      } else if ((rcAcq.completed ?? 0) > 0) {
        status = CAPABILITY_STATUS.PARTIAL;
        limitations.push(
          "Redirect-chain checks partially unsuccessful",
        );
      } else {
        status = CAPABILITY_STATUS.UNAVAILABLE;
        limitations.push(
          "Redirect-chain retrieval returned no usable data",
        );
      }
    } else if (
      isArray(site?.pages) &&
      site.pages.some(
        (p) => p?.redirectDestination,
      )
    ) {
      status = CAPABILITY_STATUS.PARTIAL;
      limitations.push(
        "Page-level redirect destinations only — redirect-chain endpoint not collected",
      );
    } else {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push(
        "Redirect evidence was not collected",
      );
    }

    caps["technical.redirects"] = capability({
      capability: "technical.redirects",
      status,
      coverage: rcCoverage,
      provenance: siteProv,
      limitations,
      requiredFieldsPresent: requiredFields,
    });
  }

  // ── technical.resources ──────────────────────────────────────────────
  {
    const resAcq =
      acquisitionOf(site, "resources");

    const resCoverage =
      coverageFromAcq(resAcq);

    let status;
    const limitations = [];
    let requiredFields = false;

    if (
      resAcq &&
      typeof resAcq.requested === "number" &&
      resAcq.requested > 0
    ) {
      if ((resAcq.failed ?? 0) === 0) {
        status = CAPABILITY_STATUS.AVAILABLE;
        requiredFields = true;
      } else if ((resAcq.completed ?? 0) > 0) {
        status = CAPABILITY_STATUS.PARTIAL;
        limitations.push(
          "Resource checks partially unsuccessful",
        );
      } else {
        status = CAPABILITY_STATUS.UNAVAILABLE;
        limitations.push(
          "Resource retrieval returned no usable data",
        );
      }
    } else {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push(
        "Resource evidence was not collected",
      );
    }

    caps["technical.resources"] = capability({
      capability: "technical.resources",
      status,
      coverage: resCoverage,
      provenance: siteProv,
      limitations,
      requiredFieldsPresent: requiredFields,
    });
  }

    // ── technical.headers ────────────────────────────────────────────────
  {
    const siteHeadersAvailable =
      site?._responseHeadersAvailable === true;

    const validationPages =
      isArray(pathValidationEvidence?.pages)
        ? pathValidationEvidence.pages
        : [];

    const securityHeaderKeys = [
      "xFrameOptions",
      "xContentTypeOptions",
      "referrerPolicy",
      "contentSecurityPolicy",
    ];

    const browserHeaderPages = [];

    for (const page of validationPages) {
      const observations = [
        page?.checks?.desktop
          ?.responseHeaders,
        page?.checks?.mobile
          ?.responseHeaders,
      ].filter(
        (value) =>
          value?.collected === true,
      );

      if (!observations.length) {
        continue;
      }

      // Conservative aggregation: a header is present for the page only
      // when every collected viewport response contained it.
      const pageHeaders =
        Object.fromEntries(
          securityHeaderKeys.map(
            (key) => [
              key,
              observations.every(
                (observation) =>
                  observation[key] === true,
              ),
            ],
          ),
        );

      browserHeaderPages.push(
        pageHeaders,
      );
    }

    const rawRequested =
      typeof pathValidationEvidence
        ?.summary?.requested === "number"
        ? pathValidationEvidence
            .summary.requested
        : validationPages.length;

    const completed =
      browserHeaderPages.length;

    const requested =
      Math.max(
        rawRequested,
        completed,
      );

    const unassessed =
      Math.max(
        0,
        requested - completed,
      );

    const browserHeadersAvailable =
      !siteHeadersAvailable &&
      completed > 0;

    const observedHeaders =
      browserHeadersAvailable
        ? Object.fromEntries(
            securityHeaderKeys.map(
              (key) => [
                key,
                browserHeaderPages.every(
                  (pageHeaders) =>
                    pageHeaders[key] === true,
                ),
              ],
            ),
          )
        : null;

    let status;
    const limitations = [];

    if (siteHeadersAvailable) {
      status =
        CAPABILITY_STATUS.AVAILABLE;
    } else if (
      browserHeadersAvailable
    ) {
      status =
        completed === requested
          ? CAPABILITY_STATUS.AVAILABLE
          : CAPABILITY_STATUS.PARTIAL;

      if (completed < requested) {
        limitations.push(
          `Response headers were collected on ${completed} of ${requested} selected browser-validated pages; unassessed pages remain unknown`,
        );
      }
    } else {
      status =
        CAPABILITY_STATUS.UNAVAILABLE;

      limitations.push(
        "Response headers were not collected by the provider or browser validation",
      );
    }

    caps["technical.headers"] =
      capability({
        capability:
          "technical.headers",

        status,

        coverage:
          browserHeadersAvailable
            ? {
                requested,
                completed,
                failed: unassessed,
              }
            : {
                requested: null,
                completed: null,
                failed: null,
              },

        provenance:
          browserHeadersAvailable
            ? {
                source:
                  pathValidationEvidence
                    ?.provider ||
                  "playwright-conversion-path",

                adapterVersion: null,
                artifactRef: null,
              }
            : siteProv,

        limitations,

        requiredFieldsPresent:
          siteHeadersAvailable ||
          browserHeadersAvailable,

        extra:
          browserHeadersAvailable
            ? {
                validated: true,

                validatedBy:
                  pathValidationEvidence
                    ?.provider ||
                  "playwright-conversion-path",

                observedHeaders,

                headerCoverage: {
                  requested,
                  completed,
                  unassessed,
                },
              }
            : {},
      });
  }

  // ── schema.structured_data ───────────────────────────────────────────
  {
    const schemaTypes =
      isArray(site?.schemaTypes)
        ? site.schemaTypes
        : null;

    const microdataTypes =
      isArray(site?.microdataTypes)
        ? site.microdataTypes
        : null;

    const mdAcq =
      acquisitionOf(site, "microdata");

    let status;
    const limitations = [];
    let requiredFields = false;

    if (
      (schemaTypes && schemaTypes.length > 0) ||
      (microdataTypes && microdataTypes.length > 0)
    ) {
      status = CAPABILITY_STATUS.AVAILABLE;
      requiredFields = true;
    } else if (contentState === "available") {
      // Body content parsed and no structured data found — confirmed absence.
      status = CAPABILITY_STATUS.AVAILABLE;
      requiredFields = true;
    } else if (
      mdAcq &&
      (mdAcq.completed ?? 0) > 0
    ) {
      // Provider micromarkup validation ran and returned nothing — confirmed absence.
      status = CAPABILITY_STATUS.AVAILABLE;
      requiredFields = true;
    } else {
      status = CAPABILITY_STATUS.UNAVAILABLE;
      limitations.push(
        "Structured-data evidence was not collected",
      );
    }

    caps["schema.structured_data"] = capability({
      capability: "schema.structured_data",
      status,
      coverage: coverageFromAcq(mdAcq),
      provenance: siteProv,
      limitations,
      requiredFieldsPresent: requiredFields,
    });
  }

  // ── performance.lab / performance.field ──────────────────────────────
  {
    const perfStatus =
      performance?.sourceStatus ?? null;

    const perfProv = {
      source:
        performance?.provider ||
        PERF_SOURCE,
      adapterVersion:
        performance?.adapterVersion ?? null,
      artifactRef: null,
    };

    const perfCoverage =
      performance?.coverage
        ? {
            requested:
              performance.coverage.requested ??
              null,
            completed:
              performance.coverage.completed ??
              null,
            failed:
              performance.coverage.failed ??
              null,
          }
        : {
            requested: null,
            completed: null,
            failed: null,
          };

    let labStatus;
    const labLimitations = [];

    if (perfStatus === "AVAILABLE") {
      labStatus = CAPABILITY_STATUS.AVAILABLE;
    } else if (perfStatus === "PARTIAL") {
      labStatus = CAPABILITY_STATUS.PARTIAL;
    } else if (perfStatus === "FAILED") {
      labStatus = CAPABILITY_STATUS.FAILED;
    } else if (perfStatus === "NOT_CONNECTED") {
      labStatus = CAPABILITY_STATUS.NOT_CONNECTED;
    } else {
      labStatus = CAPABILITY_STATUS.UNAVAILABLE;
      labLimitations.push(
        "Lab performance evidence was not collected",
      );
    }

    caps["performance.lab"] = capability({
      capability: "performance.lab",
      status: labStatus,
      coverage: perfCoverage,
      provenance: perfProv,
      limitations: labLimitations,
      requiredFieldsPresent:
        labStatus === "AVAILABLE" ||
        labStatus === "PARTIAL",
    });

    const fieldData =
      performance?.fieldData;

    const hasFieldData =
      fieldData &&
      typeof fieldData === "object" &&
      Object.keys(fieldData).length > 0;

    caps["performance.field"] = capability({
      capability: "performance.field",
      status: hasFieldData
        ? CAPABILITY_STATUS.AVAILABLE
        : CAPABILITY_STATUS.UNAVAILABLE,
      coverage: perfCoverage,
      provenance: perfProv,
      limitations: hasFieldData
        ? []
        : [
            "CrUX field data was not returned for this site (not populated or not collected)",
          ],
      requiredFieldsPresent: hasFieldData,
    });
  }

  return caps;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build the capability evidence record deterministically.
 *
 * @param {object} opts
 * @param {object} opts.decisionEvidence — hydrated decision evidence (v1.0.0)
 * @param {string} opts.auditId
 * @param {string} opts.generatedAt — ISO timestamp (lifecycle clock)
 * @returns {object} capability evidence artifact
 */
export function buildCapabilityEvidence({
  decisionEvidence,
  auditId,
  generatedAt,
  pathValidationEvidence = null,
}) {
  const capabilities = deriveCapabilities(
    decisionEvidence,
    auditId,
    pathValidationEvidence,
  );

  const summary = {
    total: CAPABILITIES.length,
    available: 0,
    partial: 0,
    unavailable: 0,
    failed: 0,
    notConnected: 0,
    notApplicable: 0,
    assessed: 0,
  };

  for (const name of CAPABILITIES) {
    const cap = capabilities[name];

    switch (cap.status) {
      case CAPABILITY_STATUS.AVAILABLE:
        summary.available += 1;
        summary.assessed += 1;
        break;

      case CAPABILITY_STATUS.PARTIAL:
        summary.partial += 1;
        summary.assessed += 1;
        break;

      case CAPABILITY_STATUS.UNAVAILABLE:
        summary.unavailable += 1;
        break;

      case CAPABILITY_STATUS.FAILED:
        summary.failed += 1;
        break;

      case CAPABILITY_STATUS.NOT_CONNECTED:
        summary.notConnected += 1;
        break;

      case CAPABILITY_STATUS.NOT_APPLICABLE:
        summary.notApplicable += 1;
        break;

      default:
        throw new Error(
          `Capability ${name} has invalid status: ${cap.status}`,
        );
    }
  }

  return {
    contractVersion: "1.0.0",
    capabilityEvidenceVersion:
      CAPABILITY_EVIDENCE_VERSION,
    auditId,
    generatedAt,
    capabilities,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Governed persistence (mirrors decision-evidence contract)
// ---------------------------------------------------------------------------

/**
 * Persist capability evidence as a governed immutable canonical artifact.
 * Fail-closed: schema-invalid artifacts are rejected before storage.
 */
export async function persistCapabilityEvidence({
  store,
  scope,
  evidence,
  validateContract,
}) {
  if (validateContract) {
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/capability-evidence.schema.json",
      evidence,
    );

    if (!sv || !sv.valid) {
      throw new Error(
        `Capability evidence validation failed: ${JSON.stringify(
          (sv?.errors || []).slice(0, 5),
        )}`,
      );
    }
  }

  const bytes = Buffer.from(
    JSON.stringify(evidence),
    "utf-8",
  );

  const record = await store.put({
    bytes,
    contentType: "application/json",
    scope: {
      ...scope,
      category: "canonical",
      artifactName:
        "capability-evidence.json",
    },
  });

  const stored = await store.get(record.key);

  if (
    !stored ||
    stored.length !== bytes.length
  ) {
    throw new Error(
      "Capability evidence read-back byte mismatch",
    );
  }

  if (
    record.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      "Capability evidence SHA-256 mismatch",
    );
  }

  if (
    typeof store.verify === "function"
  ) {
    const verified =
      await store.verify(record);

    if (!verified) {
      throw new Error(
        "Capability evidence store.verify() failed",
      );
    }
  }

  return record;
}

/**
 * Load + verify + schema-validate persisted capability evidence.
 * @throws on missing, corrupt, or schema-invalid artifacts.
 */
export async function loadAndValidateCapabilityEvidence({
  store,
  scope,
  validateContract,
}) {
  const key = buildArtifactKey({
    ...scope,
    category: "canonical",
    artifactName:
      "capability-evidence.json",
  });

  const bytes = await store.get(key);

  if (
    !bytes ||
    bytes.length === 0
  ) {
    throw new Error(
      "Capability evidence artifact not found or empty — cannot proceed without governed capability evidence",
    );
  }

  let evidence;

  try {
    evidence = JSON.parse(
      Buffer.from(bytes).toString("utf8"),
    );
  } catch (parseErr) {
    throw new Error(
      `Capability evidence artifact is not valid JSON: ${parseErr.message}`,
    );
  }

  if (validateContract) {
    const sv = validateContract(
      "https://vantage-platform.io/prysm/contracts/v1/capability-evidence.schema.json",
      evidence,
    );

    if (!sv || !sv.valid) {
      throw new Error(
        `Capability evidence validation failed on load: ${JSON.stringify(
          (sv?.errors || []).slice(0, 5),
        )}`,
      );
    }
  }

  return evidence;
}

export { CAPABILITY_STATUS };

export default {
  CAPABILITY_EVIDENCE_VERSION,
  CAPABILITIES,
  buildCapabilityEvidence,
  persistCapabilityEvidence,
  loadAndValidateCapabilityEvidence,
};