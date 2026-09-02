/**
 * Single deterministic interpretation projection for material cross-report
 * assertions. Consumers must not independently infer these labels.
 */
export function buildCrossReportInterpretation({ site = {}, scores = {}, bands = {}, conversionPaths = [] } = {}) {
  const paths = Array.isArray(conversionPaths) ? conversionPaths : [];
  const clear = paths.filter((path) => path?.status === "Clear").length;
  const weak = paths.filter((path) => path?.status === "Weak").length;
  const pathClarity = paths.length === 0
    ? "Not Assessed"
    : clear === paths.length
      ? "Clear"
      : weak > 0 ? "Weak" : "Partial";
  const serviceCount = Array.isArray(site.services) ? site.services.length : 0;
  return Object.freeze({
    version: "1.0.0",
    constructs: Object.freeze({
      offerClarity: serviceCount > 0 ? "Observed service scope" : "Not Assessed",
      ctaClarity: pathClarity,
      conversionPathClarity: pathClarity,
      trustProof: bands.trust || "Not Assessed",
      mobileUsability: scores.performance == null ? "Not Assessed" : scores.performance >= 70 ? "Strong" : "Needs attention",
      indexability: scores.technical == null ? "Not Assessed" : scores.technical >= 70 ? "Strong" : "Needs attention",
    }),
    lineage: Object.freeze({
      offerClarity: "site.services",
      ctaClarity: "conversionPaths[].status",
      conversionPathClarity: "conversionPaths[].status",
      trustProof: "bands.trust",
      mobileUsability: "scores.performance",
      indexability: "scores.technical",
    }),
  });
}
