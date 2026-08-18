/**
 * PRYSM-V2-REPORT-DEPTH-01 — "First Things First" foundational readiness.
 *
 * Answers: "before optimizing content and conversion, are the website
 * fundamentals in place?"
 *
 * NO-FABRICATION INVARIANT
 *   ASSESSED + absent      -> ACTION_REQUIRED   (a proven deficiency)
 *   NOT ASSESSED / absent  -> NOT_ASSESSED      (names the required source)
 *   provably out of scope  -> NOT_APPLICABLE
 *
 * Every item carries `assessed`, which is true only when the governed
 * capability / availability marker proves the check actually ran.  A caller
 * may therefore never read ACTION_REQUIRED without assessed evidence — this
 * is asserted directly by checklist item CR-20.
 *
 * This module adds no data source and makes no provider call.  Candidates
 * that cannot be assessed from Phase 1 evidence stay NOT_ASSESSED and state
 * the exact evidence they would need.
 */

export const FOUNDATION_STATUS = Object.freeze({
  PASS: "PASS",
  ACTION_REQUIRED: "ACTION_REQUIRED",
  NOT_ASSESSED: "NOT_ASSESSED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

export const FOUNDATION_STATUS_LABEL = Object.freeze({
  PASS: "PASS / PRESENT",
  ACTION_REQUIRED: "ACTION REQUIRED",
  NOT_ASSESSED: "NOT ASSESSED",
  NOT_APPLICABLE: "NOT APPLICABLE",
});

const AVAILABLE = new Set(["AVAILABLE", "PARTIAL"]);

// ---------------------------------------------------------------------------
// Governed evidence-scoped wording.
//
// An evidence-side failure must never be described as website behaviour.
//
// Two successive audits defeated wording guards built as blacklists (banned
// phrases) — first with novel phrasing, then with synonyms, exempt regions,
// and untested branches.  A blacklist can only ban what someone anticipated,
// so the invariant is now enforced by IDENTITY instead:
//
//   * every client-rendered failure string is a FROZEN CONSTANT with no
//     interpolation, so there is no authored region to smuggle a claim into;
//   * provider-supplied text never enters audit prose — it is carried in a
//     separate `evidenceNote` field that is always explicitly attributed to
//     the source, so it can never be read as an audit claim about the site;
//   * the tests assert exact equality against literals they declare
//     themselves, across every branch and every client-rendered field
//     (label, detail, requires, evidenceNote).
// ---------------------------------------------------------------------------

export const EVIDENCE_SCOPE_NOTE =
  "it does not describe how the website behaved for real visitors.";

/** Prefix that attributes quoted provider text, so it is never audit prose. */
export const EVIDENCE_ATTRIBUTION_PREFIX = "Evidence source reported:";

export const EVIDENCE_FAILURE_CLAUSE = Object.freeze({
  BLOCKED: {
    lead: "Crawl access was restricted for the audit crawler.",
    scope: "This is a crawl-access restriction affecting this audit only;",
  },
  FAILED: {
    lead: "Evidence collection did not return a usable result.",
    scope: "This is a limitation of the audit evidence;",
  },
  UNAVAILABLE: {
    lead: "The evidence source was not reachable for this audit.",
    scope: "This is a limitation of the audit evidence;",
  },
  NOT_CONNECTED: {
    lead: "The evidence source was not connected for this audit.",
    scope: "This is a limitation of the audit evidence;",
  },
  UNKNOWN: {
    lead: "Crawl status was not recorded for this audit.",
    scope: "This is a limitation of the audit evidence;",
  },
});

/** Fully-composed, interpolation-free detail for each failure status. */
export const EVIDENCE_FAILURE_DETAIL = Object.freeze(
  Object.fromEntries(
    Object.entries(EVIDENCE_FAILURE_CLAUSE).map(([status, c]) => [
      status,
      `${c.lead} ${c.scope} ${EVIDENCE_SCOPE_NOTE}`,
    ]),
  ),
);

export const AVAILABILITY_REQUIRES =
  "target-side availability evidence (observed HTTP responses from the site, or an uptime source)";

/** Governed epistemic note for an audit-crawler robots.txt refusal. */
export const ROBOTS_SCOPE_NOTE =
  "Because robots.txt rules apply per user agent, this does not establish that Google or Bing crawlers are blocked.";

export const ROBOTS_DETAIL = Object.freeze({
  REFUSED: `The audit crawler was refused by robots.txt. ${ROBOTS_SCOPE_NOTE}`,
  RETRIEVED:
    "A robots.txt file was retrieved and did not refuse the audit crawl. Its per-user-agent directives were not parsed.",
  NOT_RETURNED:
    "robots.txt content was not returned by the crawl provider, so its directives were not evaluated.",
});

export const ROBOTS_REQUIRES = Object.freeze({
  REFUSED: "collected robots.txt directives showing the rules that apply to search-engine user agents",
  NOT_RETURNED: "a direct robots.txt fetch with directive parsing",
});

function capStatus(model, key) {
  return model?.capabilityEvidence?.capabilities?.[key]?.status ?? "NOT_ASSESSED";
}

function capAvailable(model, key) {
  return AVAILABLE.has(capStatus(model, key));
}

function item(id, label, status, detail, extra = {}) {
  return {
    id,
    label,
    status,
    detail,
    requires: extra.requires || null,
    // Provider-supplied text is carried here, ALWAYS attributed, and never
    // interpolated into audit prose.  A limitation string that made a claim
    // about the website could therefore never be read as an audit finding.
    evidenceNote: extra.evidenceNote
      ? `${EVIDENCE_ATTRIBUTION_PREFIX} ${extra.evidenceNote}`
      : null,
    assessed: status === FOUNDATION_STATUS.PASS || status === FOUNDATION_STATUS.ACTION_REQUIRED,
    foundational: extra.foundational === true,
    linkedRuleIds: extra.linkedRuleIds || [],
  };
}

// ---------------------------------------------------------------------------
// Individual candidate assessors
// ---------------------------------------------------------------------------

function https(model) {
  const site = model?.evidence?.site || {};
  const url = site.targetUrl || site.pages?.[0]?.crawledUrl || site.pages?.[0]?.url || "";
  if (!url) {
    return item("https", "HTTPS (URL scheme)", FOUNDATION_STATUS.NOT_ASSESSED,
      "No crawled URL was available to observe the scheme.",
      { requires: "a completed crawl of the target URL", foundational: true });
  }
  const secure = /^https:/i.test(String(url));
  return item(
    "https",
    "HTTPS (URL scheme)",
    secure ? FOUNDATION_STATUS.PASS : FOUNDATION_STATUS.ACTION_REQUIRED,
    secure
      ? "The audited URL was served over HTTPS. Certificate validity and expiry were not assessed in Phase 1."
      : "The audited URL was served over plain HTTP. Visitors may see a browser security warning before they can contact you.",
    { foundational: true },
  );
}

/**
 * Every HTTP status the crawl actually observed FROM THE TARGET SITE.
 * These are target-side observations — unlike a provider/source status,
 * they are evidence about the website itself.
 */
function observedHttpStatuses(site) {
  const codes = [];
  for (const [code, count] of Object.entries(site.statusCounts || {})) {
    const n = Number(code);
    if (Number.isFinite(n) && (count ?? 0) > 0) codes.push(n);
  }
  for (const page of Array.isArray(site.pages) ? site.pages : []) {
    if (Number.isFinite(page?.statusCode)) codes.push(page.statusCode);
  }
  return codes;
}

/**
 * Site availability.
 *
 * GOVERNANCE (merge-audit correction, round 2): a provider/evidence failure
 * is NOT proof that the website was unavailable to visitors.
 *
 * Canonical `SOURCE_STATUS.FAILED` means evidence collection was attempted and
 * returned no usable records — the production DataForSEO adapter emits it for
 * rate_limit, auth, network, timeout, internal and schema_validation failures.
 * `BLOCKED` proves the audit crawler was refused, which is a crawl-access
 * restriction, not a visitor-facing outage.  Neither may be rendered as a
 * client-facing site-availability defect.
 *
 * ACTION_REQUIRED therefore requires TARGET-SIDE evidence: the crawl observed
 * HTTP responses from the site and every one of them was an error.  Note that
 * `hydrateSite` returns only {sourceStatus, collectedAt, limitations} for a
 * non-viable status, so a failed source carries no target-side observation at
 * all and can only ever resolve to NOT_ASSESSED here.
 */
function availability(model) {
  const site = model?.evidence?.site || {};
  const status = site.sourceStatus;
  const codes = observedHttpStatuses(site);
  const served = codes.filter((c) => c < 400);

  // Target-side proof of an outage: responses were observed, all were errors.
  if (codes.length > 0 && served.length === 0) {
    const unique = [...new Set(codes)].sort((a, b) => a - b);
    return item("site_availability", "Site availability", FOUNDATION_STATUS.ACTION_REQUIRED,
      `Every page the crawl requested returned an error response (HTTP ${unique.join(", ")}). Visitors reaching these URLs cannot use the site.`,
      { foundational: true });
  }

  if ((status === "AVAILABLE" || status === "PARTIAL") && (served.length > 0 || (site.pageCount ?? 0) > 0)) {
    return item("site_availability", "Site availability", FOUNDATION_STATUS.PASS,
      `The site responded and ${site.pageCount ?? served.length} page(s) were retrieved during the crawl.`,
      { foundational: true });
  }

  // Everything else — including FAILED and BLOCKED — is an evidence-side
  // limitation, reported as such and never as a website defect.
  const reason = site.errorCategory || (site.limitations || [])[0] || null;
  // The detail is a frozen constant with NO interpolation, so there is no
  // authored region in which a website claim could be introduced.  The
  // provider's own limitation text rides in `evidenceNote`, attributed.
  const detail = EVIDENCE_FAILURE_DETAIL[status] || EVIDENCE_FAILURE_DETAIL.UNKNOWN;

  return item("site_availability", "Site availability", FOUNDATION_STATUS.NOT_ASSESSED, detail,
    { requires: AVAILABILITY_REQUIRES, foundational: true, evidenceNote: reason });
}

function indexability(model) {
  const site = model?.evidence?.site || {};
  if (!capAvailable(model, "technical.indexability")) {
    return item("indexability", "Google indexability", FOUNDATION_STATUS.NOT_ASSESSED,
      "Page-level indexability signals were not collected for this audit.",
      { requires: "crawl evidence including per-page robots directives and status codes", foundational: true });
  }
  const blocked = Array.isArray(site.nonIndexablePages) ? site.nonIndexablePages : [];
  if (blocked.length > 0) {
    const sample = blocked.slice(0, 3).map((p) => `${p.url}${p.reason ? ` (${p.reason})` : ""}`).join("; ");
    return item("indexability", "Google indexability", FOUNDATION_STATUS.ACTION_REQUIRED,
      `${blocked.length} crawled page(s) cannot be indexed: ${sample}. Pages that cannot be indexed cannot be found in search.`,
      { foundational: true });
  }
  return item("indexability", "Google indexability", FOUNDATION_STATUS.PASS,
    "No crawled page was found blocking search-engine indexing.",
    { foundational: true });
}

function canonical(model) {
  const site = model?.evidence?.site || {};
  const collected = site._metaFieldAvailability?.canonicals === true;
  if (!collected) {
    return item("canonical", "Canonical tags", FOUNDATION_STATUS.NOT_ASSESSED,
      "Canonical-tag evidence was not collected for this audit.",
      { requires: "per-page canonical extraction from the crawl" });
  }
  const missing = site.missingCanonicals ?? 0;
  return missing > 0
    ? item("canonical", "Canonical tags", FOUNDATION_STATUS.ACTION_REQUIRED,
        `${missing} of ${site.pageCount ?? 0} crawled page(s) have no canonical URL, which can split how search engines treat duplicate addresses.`)
    : item("canonical", "Canonical tags", FOUNDATION_STATUS.PASS,
        "Every crawled page declared a canonical URL.");
}

function sitemap(model) {
  const urls = model?.evidence?.site?.sitemapUrls;
  if (Array.isArray(urls) && urls.length > 0) {
    return item("sitemap", "XML sitemap", FOUNDATION_STATUS.PASS,
      `${urls.length} sitemap URL(s) were discovered and used to seed the crawl.`);
  }
  // An empty list on the production path means "not returned", NOT "absent".
  return item("sitemap", "XML sitemap", FOUNDATION_STATUS.NOT_ASSESSED,
    "No sitemap URLs were returned with the crawl evidence. This does not establish that a sitemap is absent.",
    { requires: "a direct fetch of /sitemap.xml or the sitemap declared in robots.txt" });
}

/**
 * robots.txt.
 *
 * GOVERNANCE (merge-audit correction, round 2): the audit crawler being
 * refused by robots.txt does NOT prove that Googlebot or Bingbot are blocked —
 * robots.txt rules are per-user-agent, and a site may legitimately disallow a
 * third-party auditing crawler while permitting search engines.  The
 * production DataForSEO path returns `robotsText: ""`, so no directive is
 * available to evaluate that claim.  This check therefore never asserts that
 * search engines are blocked; a refusal is reported as crawl-access
 * restriction and stays NOT_ASSESSED.
 */
function robots(model) {
  const site = model?.evidence?.site || {};
  const refusedAuditCrawler = site.sourceStatus === "BLOCKED"
    && (site.limitations || []).some((l) => /robots/i.test(String(l)));
  // All three branches use frozen, interpolation-free constants.
  if (refusedAuditCrawler) {
    return item("robots_txt", "robots.txt configuration", FOUNDATION_STATUS.NOT_ASSESSED,
      ROBOTS_DETAIL.REFUSED, { requires: ROBOTS_REQUIRES.REFUSED });
  }
  if (typeof site.robotsText === "string" && site.robotsText.trim().length > 0) {
    return item("robots_txt", "robots.txt configuration", FOUNDATION_STATUS.PASS,
      ROBOTS_DETAIL.RETRIEVED);
  }
  return item("robots_txt", "robots.txt configuration", FOUNDATION_STATUS.NOT_ASSESSED,
    ROBOTS_DETAIL.NOT_RETURNED, { requires: ROBOTS_REQUIRES.NOT_RETURNED });
}

function conversionMechanism(model) {
  const site = model?.evidence?.site || {};
  const assessed = capAvailable(model, "conversion.cta") || capAvailable(model, "conversion.form");
  if (!assessed) {
    return item("conversion_mechanism", "Conversion mechanism", FOUNDATION_STATUS.NOT_ASSESSED,
      "Buttons and forms were not extracted for this audit, so the presence of a conversion action could not be established.",
      {
        requires: "interactive page evidence (rendered CTA/form extraction)",
        foundational: true,
        linkedRuleIds: ["VAN-PATH-001"],
      });
  }
  const ctas = (site.ctas || []).length;
  const forms = (site.forms || []).length;
  if (ctas === 0 && forms === 0) {
    return item("conversion_mechanism", "Conversion mechanism", FOUNDATION_STATUS.ACTION_REQUIRED,
      "No call-to-action or form was detected on the assessed pages. Visitors have no clear way to convert.",
      { foundational: true, linkedRuleIds: ["VAN-PATH-001"] });
  }
  return item("conversion_mechanism", "Conversion mechanism", FOUNDATION_STATUS.PASS,
    `${ctas} call(s) to action and ${forms} form(s) were detected on the assessed pages.`,
    { foundational: true, linkedRuleIds: ["VAN-PATH-001"] });
}

function conversionMeasurement(model) {
  const ga4 = model?.evidence?.ga4;
  const status = ga4?.sourceStatus;

  if (status === "NOT_APPLICABLE") {
    return item("conversion_measurement", "Conversion measurement", FOUNDATION_STATUS.NOT_APPLICABLE,
      "Conversion measurement was marked not applicable for this audit.",
      { foundational: true });
  }

  if (status === "AVAILABLE") {
    const readiness = ga4.measurementReadiness || {};
    const issues = Array.isArray(readiness.issues) ? readiness.issues : [];
    if (readiness.ready === false || issues.length > 0) {
      const detail = issues.slice(0, 3).map((i) => i.detail || i.type).filter(Boolean).join("; ");
      return item("conversion_measurement", "Conversion measurement", FOUNDATION_STATUS.ACTION_REQUIRED,
        `Analytics is connected but conversion outcomes cannot be verified reliably: ${detail || `${issues.length} readiness issue(s)`}. Improvements cannot be proven without trustworthy measurement.`,
        { foundational: true });
    }
    return item("conversion_measurement", "Conversion measurement", FOUNDATION_STATUS.PASS,
      "Analytics is connected and key conversion events were readable.",
      { foundational: true });
  }

  // NOT_CONNECTED / FAILED / UNAVAILABLE / absent — an unconnected analytics
  // property is NOT proof that measurement is absent on the website.
  return item("conversion_measurement", "Conversion measurement", FOUNDATION_STATUS.NOT_ASSESSED,
    "No analytics property was connected to this audit, so conversion measurement could not be evaluated. This does not establish that the website has no tracking.",
    {
      requires: "a connected GA4 property, or on-page analytics-tag detection, or CRM/booking-platform evidence",
      foundational: true,
    });
}

function primaryContact(model) {
  const site = model?.evidence?.site || {};
  if (!capAvailable(model, "content.body")) {
    return item("primary_contact", "Primary contact information", FOUNDATION_STATUS.NOT_ASSESSED,
      "Page body content was not extracted, so contact details could not be located.",
      { requires: "page content extraction" });
  }
  const pages = Array.isArray(site.pages) ? site.pages : [];
  const phone = pages.some((p) => (p?.phoneLinks || []).length > 0);
  const email = pages.some((p) => (p?.emailLinks || []).length > 0);
  if (site.trust?.contact === true || phone || email) {
    const found = [phone ? "phone" : null, email ? "email" : null].filter(Boolean).join(" and ");
    return item("primary_contact", "Primary contact information", FOUNDATION_STATUS.PASS,
      found ? `Direct ${found} contact link(s) were detected.` : "Contact information was detected on the assessed pages.");
  }
  return item("primary_contact", "Primary contact information", FOUNDATION_STATUS.ACTION_REQUIRED,
    "No contact detail was detected on the assessed pages. Visitors ready to act have no direct way to reach the business.");
}

function securityHeaders(model) {
  const site = model?.evidence?.site || {};
  if (!capAvailable(model, "technical.headers")) {
    return item("security_headers", "Basic security headers", FOUNDATION_STATUS.NOT_ASSESSED,
      "HTTP response headers were not returned by the crawl provider, so security headers were not evaluated.",
      { requires: "a crawl source that returns HTTP response headers" });
  }
  const headers = site.securityHeaders || {};
  // A capability that claims AVAILABLE but carries no observed header keys
  // proves nothing — an empty object must not render as "all headers present".
  if (Object.keys(headers).length === 0) {
    return item("security_headers", "Basic security headers", FOUNDATION_STATUS.NOT_ASSESSED,
      "No response-header values were recorded, so security headers were not evaluated.",
      { requires: "a crawl source that returns HTTP response headers" });
  }
  const absent = Object.entries(headers).filter(([, present]) => !present).map(([name]) => name);
  return absent.length > 0
    ? item("security_headers", "Basic security headers", FOUNDATION_STATUS.ACTION_REQUIRED,
        `Observed response headers do not include: ${absent.join(", ")}.`)
    : item("security_headers", "Basic security headers", FOUNDATION_STATUS.PASS,
        "The checked browser-protection headers were present in the response.");
}

function mobileExperience(model) {
  const mobile = model?.evidence?.performance?.mobile;
  const score = mobile?.scores?.performance;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return item("mobile_experience", "Mobile experience (performance signal)", FOUNDATION_STATUS.NOT_ASSESSED,
      "No mobile performance result was available for this audit. Mobile usability itself was not assessed.",
      { requires: "a completed mobile PageSpeed/Lighthouse run", foundational: true });
  }
  return score < 50
    ? item("mobile_experience", "Mobile experience (performance signal)", FOUNDATION_STATUS.ACTION_REQUIRED,
        `The mobile performance score was ${score}/100 in lab testing. Mobile usability itself was not assessed.`,
        { foundational: true })
    : item("mobile_experience", "Mobile experience (performance signal)", FOUNDATION_STATUS.PASS,
        `The mobile performance score was ${score}/100 in lab testing. Mobile usability itself was not assessed.`,
        { foundational: true });
}

// Candidates that Phase 1 evidence genuinely cannot assess.  Each names the
// exact source that would be required — no paid call is added by this package.
function unassessableCandidates() {
  return [
    item("bing_indexability", "Bing indexability", FOUNDATION_STATUS.NOT_ASSESSED,
      "Bing index status is not collected by any Phase 1 source.",
      { requires: "Bing Webmaster Tools API access" }),
    item("google_business_profile", "Google Business Profile", FOUNDATION_STATUS.NOT_ASSESSED,
      "Presence and completeness of a Google Business Profile is not collected by any Phase 1 source.",
      { requires: "Google Business Profile API access, or SERP local-pack evidence" }),
    item("nap_consistency", "NAP consistency (name, address, phone)", FOUNDATION_STATUS.NOT_ASSESSED,
      "Business address is not extracted, and no directory source is available to compare against.",
      { requires: "structured NAP extraction plus at least one directory source" }),
  ];
}

/**
 * Build the complete First Things First checklist for a scored model.
 *
 * @param {object} model — scored audit model (scoreAudit output)
 * @returns {Array<object>} checklist items in display order
 */
export function buildFoundationChecklist(model) {
  return [
    availability(model),
    https(model),
    indexability(model),
    robots(model),
    sitemap(model),
    canonical(model),
    conversionMechanism(model),
    conversionMeasurement(model),
    primaryContact(model),
    mobileExperience(model),
    securityHeaders(model),
    ...unassessableCandidates(),
  ];
}

export default { FOUNDATION_STATUS, FOUNDATION_STATUS_LABEL, buildFoundationChecklist };
