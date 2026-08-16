/**
 * PRYSM-NEXT-01 WP-G — Report design version registry.
 *
 * Design v1.0.0 (prysm-report-design-v1.0.0) is IMMUTABLE — protected by
 * docs/prysm-governance/02_PRYSM_REPORT_IMMUTABILITY_CONTRACT.md and the
 * v1 renderer (render-report.js / render-approved-report.js) plus the
 * template lock (verify-template.js).
 *
 * Design v2.0.0 (prysm-report-design-v2.0.0) is a DISTINCT design with its
 * own renderer, CSS, DOM, and golden tests.  An audit selects v2 only
 * through the versioned product contract (auditRequest.report.designVersion);
 * the production default remains v1.
 */

export const REPORT_DESIGN_V1 = "1.0.0";
export const REPORT_DESIGN_V2 = "2.0.0";

export const DEFAULT_REPORT_DESIGN = REPORT_DESIGN_V1;

export function isReportDesignV2(designVersion) {
  return designVersion === REPORT_DESIGN_V2;
}

export default {
  REPORT_DESIGN_V1,
  REPORT_DESIGN_V2,
  DEFAULT_REPORT_DESIGN,
  isReportDesignV2,
};
