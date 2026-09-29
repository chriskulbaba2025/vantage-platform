/**
 * Client-facing report product boundary.
 *
 * The only renderable products are Snapshot V1 and the current Executive
 * Report (Narrative V2). There is deliberately no legacy/default renderer.
 */
export const SNAPSHOT_V1_PRODUCT = "snapshot-v1";
export const CURRENT_EXECUTIVE_PRODUCT = "executive-v2";
export const CURRENT_EXECUTIVE_DESIGN_VERSION = "2.0.0";

export const ALLOWED_REPORT_PRODUCTS = Object.freeze(new Set([
  SNAPSHOT_V1_PRODUCT,
  CURRENT_EXECUTIVE_PRODUCT,
]));

export const RETIRED_REPORT_PRODUCTS = Object.freeze(new Set([
  "approved-report",
  "vantage-phase-1",
  "karen-leslie",
  "report-design-v1",
]));

export function isAllowedReportManifest(manifest) {
  return manifest?.reportDesignVersion === CURRENT_EXECUTIVE_DESIGN_VERSION;
}

export function isCurrentExecutiveHtml(html) {
  return typeof html === "string"
    && html.includes('data-report-design="2.0.0"');
}

export function rejectRetiredReport(message = "Retired report product is unavailable") {
  return Object.assign(new Error(message), {
    code: "RETIRED_REPORT_UNAVAILABLE",
    statusCode: 410,
  });
}
