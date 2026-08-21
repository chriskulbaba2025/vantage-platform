// PRYSM Narrative v2 — deterministic Writer reference resolution.
//
// Reference IDs are authoritative. Several canonical keys contain dots
// (for example capability:technical.indexability), so treating reference paths
// as generic dot-delimited object paths corrupts literal keys. Resolve known
// governed reference kinds from their exact IDs first, with the stored path
// retained only as a legacy fallback.

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function suffix(ref, prefix) {
  return typeof ref === "string" && ref.startsWith(prefix) ? ref.slice(prefix.length) : null;
}

export function resolveWriterReferenceValue(writerInput, ref) {
  const record = writerInput?.referenceIndex?.[ref];
  if (!isObject(record)) return undefined;

  if (record.kind === "business") {
    const key = suffix(ref, "business:");
    if (key !== null) return writerInput?.business?.[key];
  }

  if (record.kind === "score") {
    const key = suffix(ref, "score:");
    if (key !== null) {
      if (Object.hasOwn(writerInput?.score?.scores || {}, key)) return writerInput.score.scores[key];
      return writerInput?.score?.[key];
    }
  }

  if (record.kind === "finding") {
    const findingId = suffix(ref, "finding:");
    if (findingId !== null && Array.isArray(writerInput?.findings)) {
      return writerInput.findings.find((finding) => finding?.findingId === findingId);
    }
  }

  if (record.kind === "capability") {
    const key = suffix(ref, "capability:");
    if (key !== null) return writerInput?.capabilityContext?.capabilities?.[key];
  }

  if (record.kind === "source-status") {
    const key = suffix(ref, "source:");
    if (key !== null) return writerInput?.scoreGovernance?.sourceDependencies?.[key];
  }

  if (record.kind === "deterministic-analysis") {
    const key = suffix(ref, "analysis:");
    if (key !== null) return writerInput?.deterministicAnalysis?.[key];
  }

  if (typeof record.path !== "string" || !record.path) return undefined;
  return record.path.split(".").reduce((value, key) => value?.[key], writerInput);
}

export function governedStatusForWriterReference(writerInput, ref) {
  const record = writerInput?.referenceIndex?.[ref];
  if (!isObject(record)) return undefined;
  const value = resolveWriterReferenceValue(writerInput, ref);
  if (record.kind === "source-status") {
    return typeof value === "string" && value.trim() ? value : undefined;
  }
  if (record.kind === "capability" && isObject(value)) {
    return typeof value.status === "string" && value.status.trim() ? value.status : undefined;
  }
  return undefined;
}

export default { resolveWriterReferenceValue, governedStatusForWriterReference };
