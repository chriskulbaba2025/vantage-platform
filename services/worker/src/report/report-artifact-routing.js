/**
 * Client-facing report product routing.
 * Snapshot V1 and the current Executive Report are the only products.
 * Historical report namespaces are intentionally never candidates.
 */
export function reportArtifactCandidates(filename) {
  if (filename === "index.html" || filename === "snapshot.html") {
    return [];
  }
  if (filename === "executive.html") {
    return [
      { category: "report-v2", artifactName: "pages/index.html" },
    ];
  }
  return [];
}
