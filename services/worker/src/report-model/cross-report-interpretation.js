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
  // CTA clarity measures invitation visibility; path clarity measures whether
  // that invitation can be completed. They deliberately have separate inputs.
  const ctas = Array.isArray(site.ctas) ? site.ctas : [];
  const ctaClarity = ctas.length === 0
    ? "No CTA observed"
    : ctas.some((cta) => !String(cta?.text || "").trim() || !String(cta?.url || "").trim())
      ? "Partial"
      : "Clear";
  const serviceCount = Array.isArray(site.services) ? site.services.length : 0;
  return Object.freeze({
    version: "1.0.0",
    constructs: Object.freeze({
      offerClarity: serviceCount > 0 ? "Observed service scope" : "Not Assessed",
      ctaClarity,
      conversionPathClarity: pathClarity,
      trustProof: bands.trust || "Not Assessed",
      mobileUsability: scores.performance == null ? "Not Assessed" : scores.performance >= 70 ? "Strong" : "Needs attention",
      indexability: !Array.isArray(site.nonIndexablePages)
        ? "Not Assessed"
        : site.nonIndexablePages.length > 0 ? "Needs attention" : "Strong",
    }),
    lineage: Object.freeze({
      offerClarity: "site.services",
      ctaClarity: "site.ctas[].text,url",
      conversionPathClarity: "conversionPaths[].status",
      trustProof: "bands.trust",
      mobileUsability: "scores.performance",
      indexability: "site.nonIndexablePages",
    }),
  });
}

/** Enforces the persisted current-report contract at consumer boundaries. */
export function requireCrossReportInterpretation(model) {
  const projection = model?.crossReportInterpretation;
  const constructs = projection?.constructs;
  const requiredConstructs = ["offerClarity", "ctaClarity", "conversionPathClarity", "trustProof", "mobileUsability", "indexability"];
  if (!projection || projection.version !== "1.0.0" || !constructs || requiredConstructs.some((key) => typeof constructs[key] !== "string")) {
    throw new Error("Current report model requires persisted cross-report interpretation");
  }
  return projection;
}
