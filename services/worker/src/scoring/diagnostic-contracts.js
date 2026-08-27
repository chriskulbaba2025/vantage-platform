/**
 * Vantage Rendering-Integrity Diagnostic Contracts
 *
 * Provider-independent diagnostic classification for rendering failures
 * detected during automated PageSpeed Insights and Lighthouse testing.
 *
 * Every diagnostic record captures:
 *  - The specific diagnostic code and category
 *  - The evidence that supports the classification
 *  - Client-facing and technical explanations
 *  - Confidence, business impact, and recommended action
 *
 * All diagnostics are `scoreBearing: false` — they explain *why*
 * performance could not be measured, rather than fabricating a score.
 */

import {
  BUSINESS_IMPACT_BASIS,
  governBusinessImpact,
} from "./business-impact-policy.js";

// ---------------------------------------------------------------------------
// Diagnostic code vocabulary (22 canonical codes)
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_CODE = Object.freeze({
  /** First Contentful Paint never fired. Page started loading but no content painted. */
  NO_FCP:                        "NO_FCP",
  /** Largest Contentful Paint never fired. FCP fired but no LCP candidate appeared. */
  NO_LCP:                        "NO_LCP",
  /** Page remained blank — no visible content rendered at all. */
  PAGE_BLANK:                    "PAGE_BLANK",
  /** Above-the-fold content rendered incompletely. */
  INCOMPLETE_ABOVE_FOLD:         "INCOMPLETE_ABOVE_FOLD",
  /** Main image, video, iframe, canvas, or background media failed to render. */
  MEDIA_FAILED:                  "MEDIA_FAILED",
  /** A loading screen or overlay remained visible and blocked content. */
  LOADING_SCREEN_STUCK:          "LOADING_SCREEN_STUCK",
  /** JavaScript execution failed, preventing page rendering. */
  JS_EXECUTION_FAILURE:          "JS_EXECUTION_FAILURE",
  /** Navigation to the target URL timed out. */
  NAVIGATION_TIMEOUT:            "NAVIGATION_TIMEOUT",
  /** Page load timed out before completion. */
  PAGE_LOAD_TIMEOUT:             "PAGE_LOAD_TIMEOUT",
  /** Redirect loop or unexpected final URL after navigation. */
  REDIRECT_LOOP:                 "REDIRECT_LOOP",
  /** Authentication, consent, or login wall prevented page access. */
  AUTH_WALL:                     "AUTH_WALL",
  /** Robots, access controls, or server configuration blocked access. */
  ACCESS_BLOCKED:                "ACCESS_BLOCKED",
  /** The page itself returned an HTTP 4xx or 5xx status. */
  HTTP_ERROR_PAGE:               "HTTP_ERROR_PAGE",
  /** TLS or DNS failure prevented connection to the target. */
  TLS_DNS_FAILURE:               "TLS_DNS_FAILURE",
  /** The browser process crashed during testing. */
  BROWSER_CRASH:                 "BROWSER_CRASH",
  /** The page renderer process crashed. */
  RENDERER_CRASH:                "RENDERER_CRASH",
  /** Page content type is unsupported (e.g. PDF, download, non-HTML). */
  UNSUPPORTED_CONTENT:           "UNSUPPORTED_CONTENT",
  /** Required Lighthouse metrics are all missing despite a valid run. */
  MISSING_REQUIRED_METRICS:      "MISSING_REQUIRED_METRICS",
  /** HTTP 200 response but performance category score is null. */
  NULL_PERF_HTTP200:             "NULL_PERF_HTTP200",
  /** Provider quota or rate limiting prevented testing. */
  PROVIDER_RATE_LIMIT:           "PROVIDER_RATE_LIMIT",
  /** Provider internal error prevented testing. */
  PROVIDER_INTERNAL_ERROR:       "PROVIDER_INTERNAL_ERROR",
  /** Rendering failure detected but specific cause could not be determined. */
  UNKNOWN_RENDERING_FAILURE:     "UNKNOWN_RENDERING_FAILURE",
});

// ---------------------------------------------------------------------------
// Diagnostic categories
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_CATEGORY = Object.freeze({
  /** Site content did not render correctly — actionable by the site owner. */
  SITE_RENDERING:   "SITE_RENDERING",
  /** Provider-side issue prevented testing (quota, internal error, crash). */
  PROVIDER:         "PROVIDER",
  /** Infrastructure failure (TLS, DNS) prevented connection. */
  INFRASTRUCTURE:   "INFRASTRUCTURE",
  /** Failure detected but specific cause unknown. */
  UNKNOWN:          "UNKNOWN",
});

// ---------------------------------------------------------------------------
// Visible render state vocabulary
// ---------------------------------------------------------------------------

export const VISIBLE_RENDER_STATE = Object.freeze({
  /** Content rendered visibly in the viewport. */
  RENDERED:             "RENDERED",
  /** No visible content — page was blank. */
  BLANK:                "BLANK",
  /** Some content rendered but not completely. */
  PARTIAL:              "PARTIAL",
  /** An overlay, loading screen, or spinner blocked visible content. */
  OVERLAY_BLOCKED:      "OVERLAY_BLOCKED",
  /** Render state could not be determined from available evidence. */
  UNKNOWN:              "UNKNOWN",
});

// ---------------------------------------------------------------------------
// Diagnostic envelope version
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_ENVELOPE_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Category lookup by code
// ---------------------------------------------------------------------------

const CODE_TO_CATEGORY = Object.freeze({
  [DIAGNOSTIC_CODE.NO_FCP]:                    DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.NO_LCP]:                    DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.PAGE_BLANK]:                DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.INCOMPLETE_ABOVE_FOLD]:     DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.MEDIA_FAILED]:              DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.LOADING_SCREEN_STUCK]:      DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.JS_EXECUTION_FAILURE]:      DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.REDIRECT_LOOP]:             DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.AUTH_WALL]:                 DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.ACCESS_BLOCKED]:            DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.HTTP_ERROR_PAGE]:           DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.UNSUPPORTED_CONTENT]:       DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.MISSING_REQUIRED_METRICS]:  DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.NULL_PERF_HTTP200]:         DIAGNOSTIC_CATEGORY.SITE_RENDERING,
  [DIAGNOSTIC_CODE.NAVIGATION_TIMEOUT]:        DIAGNOSTIC_CATEGORY.PROVIDER,
  [DIAGNOSTIC_CODE.PAGE_LOAD_TIMEOUT]:         DIAGNOSTIC_CATEGORY.PROVIDER,
  [DIAGNOSTIC_CODE.BROWSER_CRASH]:             DIAGNOSTIC_CATEGORY.PROVIDER,
  [DIAGNOSTIC_CODE.RENDERER_CRASH]:            DIAGNOSTIC_CATEGORY.PROVIDER,
  [DIAGNOSTIC_CODE.PROVIDER_RATE_LIMIT]:       DIAGNOSTIC_CATEGORY.PROVIDER,
  [DIAGNOSTIC_CODE.PROVIDER_INTERNAL_ERROR]:   DIAGNOSTIC_CATEGORY.PROVIDER,
  [DIAGNOSTIC_CODE.TLS_DNS_FAILURE]:           DIAGNOSTIC_CATEGORY.INFRASTRUCTURE,
  [DIAGNOSTIC_CODE.UNKNOWN_RENDERING_FAILURE]: DIAGNOSTIC_CATEGORY.UNKNOWN,
});

/**
 * Return the diagnostic category for a given diagnostic code.
 */
export function diagnosticCategoryForCode(code) {
  return CODE_TO_CATEGORY[code] ?? DIAGNOSTIC_CATEGORY.UNKNOWN;
}

// ---------------------------------------------------------------------------
// Suspected failed element types
// ---------------------------------------------------------------------------

export const FAILED_ELEMENT_TYPE = Object.freeze({
  IMAGE:      "image",
  VIDEO:      "video",
  IFRAME:     "iframe",
  CANVAS:     "canvas",
  BACKGROUND: "background-media",
  OVERLAY:    "overlay",
  SCRIPT:     "script",
});

// ---------------------------------------------------------------------------
// Diagnostic record builder
// ---------------------------------------------------------------------------

/**
 * Build a canonical rendering-integrity diagnostic record.
 *
 * Every diagnostic:
 *  - References specific provider evidence
 *  - Is `scoreBearing: false`
 *  - Includes client-facing and technical explanations
 *  - Carries provenance timestamps and confidence
 */
export function buildDiagnostic(fields) {
  const businessImpact = governBusinessImpact(
    fields.businessImpact,
    {
      label: `Diagnostic ${fields.diagnosticCode} businessImpact`,
      basis: fields.businessImpactBasis ?? BUSINESS_IMPACT_BASIS.INFERRED,
    },
  );

  return Object.freeze({
    diagnosticCode:             fields.diagnosticCode,
    diagnosticCategory:         diagnosticCategoryForCode(fields.diagnosticCode),
    affectedUrl:                fields.affectedUrl,
    requestedDevice:            Object.freeze([...(fields.requestedDevice ?? [])]),
    provider:                   fields.provider,
    providerStatus:             fields.providerStatus ?? null,
    finalUrl:                   fields.finalUrl ?? null,
    httpStatus:                 fields.httpStatus ?? null,
    runtimeErrorCode:           fields.runtimeErrorCode ?? null,
    runtimeErrorMessage:        fields.runtimeErrorMessage ?? null,
    missingMetrics:             Object.freeze([...(fields.missingMetrics ?? [])]),
    visibleRenderState:         fields.visibleRenderState ?? VISIBLE_RENDER_STATE.UNKNOWN,
    suspectedFailedElementType: fields.suspectedFailedElementType ?? null,
    screenshotArtifactRef:      fields.screenshotArtifactRef ?? null,
    networkEvidenceRefs:        Object.freeze([...(fields.networkEvidenceRefs ?? [])]),
    consoleEvidenceRefs:        Object.freeze([...(fields.consoleEvidenceRefs ?? [])]),
    confidence:                 fields.confidence ?? 0,
    clientExplanation:          fields.clientExplanation,
    technicalExplanation:       fields.technicalExplanation,
    businessImpact,
    recommendation:             fields.recommendation,
    verificationMethod:         fields.verificationMethod,
    scoreBearing:               false,
    // Provenance
    ruleVersion:                "1.0.0",
    collectedAt:                fields.collectedAt ?? new Date().toISOString(),
    evidenceProfileHash:        fields.evidenceProfileHash ?? null,
  });
}

// ---------------------------------------------------------------------------
// Diagnostic envelope builder
// ---------------------------------------------------------------------------

/**
 * Build a diagnostic envelope wrapping multiple diagnostic records
 * with summary metadata.
 */
export function buildDiagnosticEnvelope(fields) {
  return Object.freeze({
    envelopeVersion: DIAGNOSTIC_ENVELOPE_VERSION,
    diagnostics: Object.freeze([...(fields.diagnostics ?? [])]),
    summary: Object.freeze({
      totalDiagnostics:    (fields.diagnostics ?? []).length,
      siteRenderingCount:  (fields.diagnostics ?? []).filter(
        (d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.SITE_RENDERING,
      ).length,
      providerCount:       (fields.diagnostics ?? []).filter(
        (d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.PROVIDER,
      ).length,
      infrastructureCount: (fields.diagnostics ?? []).filter(
        (d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.INFRASTRUCTURE,
      ).length,
      unknownCount:        (fields.diagnostics ?? []).filter(
        (d) => d.diagnosticCategory === DIAGNOSTIC_CATEGORY.UNKNOWN,
      ).length,
    }),
    affectedUrl: fields.affectedUrl ?? null,
    collectedAt: fields.collectedAt ?? new Date().toISOString(),
    _meta: Object.freeze({
      adapterVersion: "1.0.0",
      ruleVersion: "1.0.0",
    }),
  });
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Return true when `value` is a recognised diagnostic code.
 */
export function isValidDiagnosticCode(value) {
  return Object.values(DIAGNOSTIC_CODE).includes(value);
}

/**
 * Return true when `value` is a recognised diagnostic category.
 */
export function isValidDiagnosticCategory(value) {
  return Object.values(DIAGNOSTIC_CATEGORY).includes(value);
}

/**
 * Return true when `value` is a recognised visible render state.
 */
export function isValidVisibleRenderState(value) {
  return Object.values(VISIBLE_RENDER_STATE).includes(value);
}

/**
 * Validate a diagnostic record shape.
 * Returns `{ valid, errors }` — never throws.
 */
export function validateDiagnostic(shape, label = "diagnostic") {
  const errors = [];

  if (!shape || typeof shape !== "object") {
    return { valid: false, errors: [`${label}: not an object`] };
  }

  if (!isValidDiagnosticCode(shape.diagnosticCode)) {
    errors.push(
      `${label}: invalid or missing diagnosticCode "${shape.diagnosticCode}"`,
    );
  }

  if (!isValidDiagnosticCategory(shape.diagnosticCategory)) {
    errors.push(
      `${label}: invalid or missing diagnosticCategory "${shape.diagnosticCategory}"`,
    );
  }

  if (
    !shape.clientExplanation ||
    typeof shape.clientExplanation !== "string"
  ) {
    errors.push(`${label}: missing clientExplanation`);
  }

  if (
    !shape.technicalExplanation ||
    typeof shape.technicalExplanation !== "string"
  ) {
    errors.push(`${label}: missing technicalExplanation`);
  }

  if (
    shape.confidence == null ||
    typeof shape.confidence !== "number" ||
    shape.confidence < 0 ||
    shape.confidence > 1
  ) {
    errors.push(
      `${label}: confidence must be a number 0–1, got ${shape.confidence}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Template explanations — per diagnostic code
// ---------------------------------------------------------------------------

const EXPLANATIONS = Object.freeze({
  [DIAGNOSTIC_CODE.NO_FCP]: {
    client:
      "The page did not begin rendering visible content during automated testing. This occurred during the recorded test and may not affect all visitors.",
    technical:
      "The First Contentful Paint (FCP) audit returned null. No visible content was painted to the screen within the test duration.",
    impact:
      "A missing FCP may mean visitors see a blank page during the tested load, creating a risk that visible content is delayed.",
    recommendation:
      "Audit render-blocking resources, server response time, and critical CSS delivery. Verify that the page renders content without requiring JavaScript for initial paint.",
    verification:
      "Re-test with PageSpeed Insights and confirm FCP is reported. Use WebPageTest to capture a filmstrip of the initial render sequence.",
  },

  [DIAGNOSTIC_CODE.NO_LCP]: {
    client:
      "The largest content element on the page did not render during automated testing. This occurred during the recorded test and may not affect all visitors.",
    technical:
      "The Largest Contentful Paint (LCP) audit returned null numericValue. FCP was recorded (indicating the page started rendering), but the largest contentful paint never fired.",
    impact:
      "A missing LCP may indicate that primary content did not become measurable during the test, creating a risk of delayed visible content.",
    recommendation:
      "Inspect the LCP candidate element. Verify that hero images, heading text, or background media load promptly. Check for lazy-loading that may delay or prevent LCP.",
    verification:
      "Re-test with PageSpeed Insights and confirm LCP is reported. Use the LCP audit's `items` array in the raw Lighthouse result to identify the LCP candidate.",
  },

  [DIAGNOSTIC_CODE.PAGE_BLANK]: {
    client:
      "The page remained blank during automated testing. No visible content appeared in the test viewport.",
    technical:
      "All content-paint audits (FCP, LCP, Speed Index) returned null. The final screenshot, where available, confirmed a blank viewport.",
    impact:
      "A blank render during testing may indicate a severe content-delivery risk for visitors and automated systems.",
    recommendation:
      "Check that the page returns valid HTML content. Verify that no blocking overlay, redirect, or JavaScript error prevents rendering. Test in a headless browser.",
    verification:
      "Load the page in a headless browser and capture a screenshot. Compare with the test screenshot to confirm the blank state.",
  },

  [DIAGNOSTIC_CODE.INCOMPLETE_ABOVE_FOLD]: {
    client:
      "Above-the-fold content did not render completely during automated testing.",
    technical:
      "Some metrics were recorded but key paint metrics were missing. The page started rendering but did not complete above-the-fold content delivery.",
    impact:
      "Incomplete above-fold rendering may create a risk that visitors encounter partially loaded content.",
    recommendation:
      "Audit lazy-loaded above-fold resources, render-blocking CSS, and dynamic content injection. Ensure critical resources are prioritized.",
    verification:
      "Use WebPageTest filmstrip view to confirm above-fold completeness. Compare FCP timing with visual completeness timing.",
  },

  [DIAGNOSTIC_CODE.MEDIA_FAILED]: {
    client:
      "One or more media elements (images, videos, or embedded content) failed to load during automated testing.",
    technical:
      "Network records or console entries indicated that image, video, iframe, canvas, or background media resources failed to load (HTTP errors, blocked requests, or loading errors).",
    impact:
      "Failed media may degrade the visual experience and weaken trust cues.",
    recommendation:
      "Audit media resource URLs. Verify that CDN or hosting paths are accessible. Check for hotlink protection, CORS policies, or expired URLs.",
    verification:
      "Review the network request log from the test for failed media resources. Cross-reference console errors for media loading failures.",
  },

  [DIAGNOSTIC_CODE.LOADING_SCREEN_STUCK]: {
    client:
      "A loading screen or overlay remained visible during automated testing, preventing page content from being measured.",
    technical:
      "The test detected a persistent loading indicator. FCP was delayed or absent, and the interactive timing was significantly elevated relative to any visible paint.",
    impact:
      "A persistent loading screen may prevent visitors from reaching page content or primary actions.",
    recommendation:
      "Audit the loading screen dismissal logic. Ensure it does not depend on a single slow API response or a JavaScript condition that may never be met.",
    verification:
      "Capture a screenshot and filmstrip via WebPageTest. Confirm whether the loading screen resolves within a reasonable time on various connections.",
  },

  [DIAGNOSTIC_CODE.JS_EXECUTION_FAILURE]: {
    client:
      "A JavaScript error prevented the page from rendering correctly during automated testing.",
    technical:
      "The Lighthouse runtime error or console entries recorded a JavaScript execution failure. This prevented the page from completing its render cycle.",
    impact:
      "JavaScript execution failures may prevent critical content, forms, CTAs, or navigation from functioning.",
    recommendation:
      "Audit browser console errors. Fix uncaught exceptions, missing dependencies, and polyfill gaps. Add error boundaries for non-critical scripts.",
    verification:
      "Re-test and confirm zero console errors. Verify that critical user flows function without JavaScript errors.",
  },

  [DIAGNOSTIC_CODE.NAVIGATION_TIMEOUT]: {
    client:
      "The automated test could not reach the page within the allowed time.",
    technical:
      "Navigation to the target URL timed out. The browser was unable to establish a connection and begin loading the page within the test timeout window.",
    impact:
      "Repeated navigation timeouts may indicate a risk that the page is slow or intermittently unreachable for visitors.",
    recommendation:
      "Check server response time, DNS resolution, and network path. Consider increasing server resources or optimizing the hosting configuration.",
    verification:
      "Test connectivity to the target URL from multiple geographic locations. Measure Time to First Byte (TTFB).",
  },

  [DIAGNOSTIC_CODE.PAGE_LOAD_TIMEOUT]: {
    client:
      "The page did not finish loading within the automated test time limit.",
    technical:
      "The page began loading but did not reach the load completion event within the test timeout. Some resources may still have been in flight.",
    impact:
      "A page-load timeout may create user-experience friction and may indicate persistent loading problems.",
    recommendation:
      "Audit total page weight, server response time, and resource loading sequence. Defer non-critical resources and implement lazy loading below the fold.",
    verification:
      "Test with WebPageTest to identify the slowest-loading resources. Compare load time across multiple test locations.",
  },

  [DIAGNOSTIC_CODE.REDIRECT_LOOP]: {
    client:
      "The page entered a redirect loop during automated testing and never settled on a final URL.",
    technical:
      "The final URL after navigation differed from the requested URL, and the redirect chain indicated excessive or circular redirects.",
    impact:
      "A redirect loop may prevent visitors and crawlers from reaching page content.",
    recommendation:
      "Audit server redirect rules (.htaccess, nginx config, CDN rules, CMS redirect plugins). Break any circular redirect chains.",
    verification:
      "Use a redirect checker tool to trace the full redirect path. Confirm the chain terminates at a valid 200-status URL.",
  },

  [DIAGNOSTIC_CODE.AUTH_WALL]: {
    client:
      "The page required authentication or consent before content could be accessed. The automated test could not proceed past this gate.",
    technical:
      "The final URL differed from the target and contained authentication or consent patterns. The test could not access the actual page content.",
    impact:
      "An authentication or consent wall may prevent public performance testing from representing the intended page experience.",
    recommendation:
      "If this is a public page, remove authentication requirements. If testing a gated page, configure test credentials or test a representative public page instead.",
    verification:
      "Visit the target URL in an incognito browser window to confirm whether authentication is required. Review server access logs for the test request.",
  },

  [DIAGNOSTIC_CODE.ACCESS_BLOCKED]: {
    client:
      "Access to the page was blocked during automated testing.",
    technical:
      "The server returned an access-denied response (HTTP 403), or the request was blocked by robots.txt, a WAF, or bot detection.",
    impact:
      "Blocked automated access may prevent performance measurement and may also affect legitimate testing tools.",
    recommendation:
      "Review server access controls, WAF rules, and robots.txt configuration. Allowlist performance testing user agents if appropriate.",
    verification:
      "Check server access logs for the test request. Verify the HTTP status code and any blocking headers returned.",
  },

  [DIAGNOSTIC_CODE.HTTP_ERROR_PAGE]: {
    client:
      "The page returned an HTTP error status during automated testing.",
    technical:
      "The main document response had an HTTP 4xx or 5xx status code. The test captured whatever content the server returned for this error status.",
    impact:
      "An HTTP error response may prevent visitors and crawlers from reaching the intended page content.",
    recommendation:
      "Investigate the server error. Check server logs, application error tracking, and database connectivity. Fix the underlying issue and verify the page returns HTTP 200.",
    verification:
      "Re-test the URL and confirm HTTP 200. Check server error logs for the root cause of the 4xx/5xx response.",
  },

  [DIAGNOSTIC_CODE.TLS_DNS_FAILURE]: {
    client:
      "A secure connection to the page could not be established during automated testing.",
    technical:
      "The test encountered a TLS certificate error, DNS resolution failure, or protocol mismatch when attempting to connect to the target URL.",
    impact:
      "TLS or DNS failures may prevent visitors and crawlers from establishing a connection to the page.",
    recommendation:
      "Verify the SSL/TLS certificate is valid, not expired, and covers the target domain. Check DNS records for correctness and propagation.",
    verification:
      "Use an SSL checker tool to validate the certificate chain. Verify DNS resolution from multiple locations.",
  },

  [DIAGNOSTIC_CODE.BROWSER_CRASH]: {
    client:
      "The automated testing browser crashed during the test. This is a provider-side issue, not a problem with the page itself.",
    technical:
      "The browser process terminated unexpectedly during the test (error code: BROWSER_CRASH, TARGET_CLOSED, or BROWSER_DISCONNECTED).",
    impact:
      "A browser crash may prevent performance data collection without establishing a defect in the target page.",
    recommendation:
      "Re-run the test. If browser crashes persist, the page may contain resource-intensive content that exceeds the test environment's memory or CPU limits.",
    verification:
      "Re-run the test and confirm the browser completes normally. If crashes persist, test with a simpler page to isolate environment vs. page causes.",
  },

  [DIAGNOSTIC_CODE.RENDERER_CRASH]: {
    client:
      "The page renderer crashed during automated testing. This may indicate a page-level issue or a provider-side problem.",
    technical:
      "The page renderer process terminated unexpectedly (error code: RENDERER_CRASH, PAGE_CRASH, or TAB_CRASH).",
    impact:
      "A renderer crash may prevent performance data collection and may indicate either a page-level or test-environment issue.",
    recommendation:
      "Audit the page for memory-intensive operations, large DOM trees, or infinite JavaScript loops. Re-test to determine if the crash is reproducible.",
    verification:
      "Re-test the page and monitor memory usage. Use Chrome DevTools Performance profiler to identify excessive resource consumption.",
  },

  [DIAGNOSTIC_CODE.UNSUPPORTED_CONTENT]: {
    client:
      "The page content type is not supported for performance testing.",
    technical:
      "The target URL returned a non-HTML content type (e.g. PDF, file download, JSON) that cannot be rendered and measured by performance testing tools.",
    impact:
      "Unsupported content may prevent browser-based performance testing from evaluating this URL as a web page.",
    recommendation:
      "If this URL is intended to be a web page, verify that the server returns Content-Type: text/html. If it is a file download, performance testing is not applicable.",
    verification:
      "Check the Content-Type header returned by the target URL. Confirm it is text/html for web pages.",
  },

  [DIAGNOSTIC_CODE.MISSING_REQUIRED_METRICS]: {
    client:
      "The page loaded successfully but required performance metrics could not be collected during automated testing.",
    technical:
      "The page returned HTTP 200 with no runtime error, but Lighthouse could not compute core metrics (FCP, LCP, CLS, TBT). The Lighthouse result was structurally valid but metric values were absent.",
    impact:
      "Missing required metrics may prevent a reliable performance assessment for this test.",
    recommendation:
      "This is unusual for a valid HTML page. Check that the page has visible, measurable content. Verify that Lighthouse audits are not suppressed by page configuration.",
    verification:
      "Re-test and review the raw Lighthouse JSON. Confirm that metric audits exist and have numeric values.",
  },

  [DIAGNOSTIC_CODE.NULL_PERF_HTTP200]: {
    client:
      "The page loaded with HTTP 200 but did not produce a performance score during automated testing.",
    technical:
      "The HTTP response was successful, but the Lighthouse performance category score was null. The page loaded but either took too long to reach measurable state or had insufficient content for scoring.",
    impact:
      "A null performance score may prevent benchmarking and may indicate that additional diagnostic evidence is needed.",
    recommendation:
      "Review the Lighthouse report for diagnostic audits. Check if the page timed out during metric collection. Verify that the page has sufficient DOM content for measurement.",
    verification:
      "Re-test and review Lighthouse diagnostic audits. Use WebPageTest to independently measure page load performance.",
  },

  [DIAGNOSTIC_CODE.PROVIDER_RATE_LIMIT]: {
    client:
      "Performance testing could not be completed because the testing service reached its request quota. This is a provider-side limitation.",
    technical:
      "The PageSpeed Insights API returned HTTP 429 (rate limit) or the error category indicated quota exhaustion. Lighthouse fallback was either unavailable or also failed.",
    impact:
      "Provider rate limiting may delay performance assessment but does not establish a problem with the target page.",
    recommendation:
      "Wait and re-test. If rate limiting occurs frequently, consider provisioning additional API quota or scheduling tests during off-peak periods.",
    verification:
      "Re-test after the rate-limit window resets. Monitor provider quota usage across audits.",
  },

  [DIAGNOSTIC_CODE.PROVIDER_INTERNAL_ERROR]: {
    client:
      "Performance testing could not be completed due to an internal error in the testing service. This is a provider-side issue.",
    technical:
      "The testing provider returned an internal error (HTTP 5xx or equivalent). The target page was not reached or tested.",
    impact:
      "A provider internal error may delay performance assessment but does not establish a problem with the target page.",
    recommendation:
      "Re-run the test. If provider errors persist, check the provider status page for ongoing incidents.",
    verification:
      "Re-test and confirm the provider returns a successful response. Monitor provider error rates across audits.",
  },

  [DIAGNOSTIC_CODE.UNKNOWN_RENDERING_FAILURE]: {
    client:
      "The page did not render completely during automated testing.",
    technical:
      "A rendering failure was detected but could not be classified into a specific category with the available evidence. Known observations and missing evidence are documented in the diagnostic record.",
    impact:
      "An unclassified rendering failure may prevent reliable performance assessment until additional evidence identifies the cause.",
    recommendation:
      "Manually review the test evidence: screenshots, network logs, console output, and runtime errors. Cross-reference with independent testing tools.",
    verification:
      "Re-test with expanded diagnostic evidence collection. Use WebPageTest, browser DevTools, and manual inspection to identify the specific failure mode.",
  },
});

/**
 * Retrieve explanation templates for a diagnostic code.
 */
export function getExplanations(code) {
  return (
    EXPLANATIONS[code] ??
    EXPLANATIONS[DIAGNOSTIC_CODE.UNKNOWN_RENDERING_FAILURE]
  );
}

// ---------------------------------------------------------------------------
// Coverage self-check — ensures every code has explanation templates
// ---------------------------------------------------------------------------

/**
 * Validate that every defined diagnostic code has corresponding explanation
 * templates. Returns { complete, missing } — useful for test-time verification.
 */
export function verifyExplanationCoverage() {
  const codes = Object.values(DIAGNOSTIC_CODE);
  const missing = codes.filter((code) => !EXPLANATIONS[code]);

  return {
    complete: missing.length === 0,
    missing,
  };
}
