/** Current client-facing report design registry. */

export const REPORT_DESIGN_V2 = "2.0.0";
export const DEFAULT_REPORT_DESIGN = REPORT_DESIGN_V2;

export function isReportDesignV2(designVersion) {
  return designVersion === REPORT_DESIGN_V2;
}

export default {
  REPORT_DESIGN_V2,
  DEFAULT_REPORT_DESIGN,
  isReportDesignV2,
};
