import { createHash } from "node:crypto";

const PAGE_FIELDS = Object.freeze(["title", "description", "canonical", "status", "schemaTypes", "words"]);

function stable(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function evidenceId(record) {
  return createHash("sha256").update(JSON.stringify(stable({
    tenantId: record.tenantId, auditId: record.auditId, pageUrl: record.pageUrl,
    evidenceType: record.evidenceType, source: record.source,
    providerArtifactRef: record.providerArtifactRef, observedAt: record.observedAt,
    observedValue: record.observedValue,
  }))).digest("hex").slice(0, 32);
}

function addRecord(records, record) {
  if (record.observedValue === undefined) return;
  records.push({ ...record, evidenceId: evidenceId(record) });
}

/** Project normalized SourceResults into stable, page/source-scoped evidence records. */
export function projectEvidenceRecords({ auditRequest, allSourceResults = [] } = {}) {
  const records = [];
  const { tenantId, clientId, auditId } = auditRequest || {};
  for (const entry of allSourceResults) {
    const sr = entry?.sourceResult || {};
    const evidence = sr.evidence && typeof sr.evidence === "object" ? sr.evidence : {};
    const common = {
      tenantId, clientId, auditId, websiteId: auditRequest?.targetUrl || null,
      source: entry.source, providerArtifactRef: entry.rawRecord?.key || sr.artifact?.key || null,
      observedAt: sr.completedAt || null, status: sr.status || "UNKNOWN",
      sufficiency: sr.status === "AVAILABLE" ? "SUFFICIENT" : sr.status === "PARTIAL" ? "PARTIAL" : "INSUFFICIENT",
      provenance: entry.source, independence: entry.source,
    };
    addRecord(records, { ...common, evidenceType: `source:${entry.source}`, observedValue: { status: sr.status, coverage: sr.coverage || null } });

    const pages = Array.isArray(evidence.pages) ? evidence.pages : [];
    for (const page of pages) {
      if (!page?.url) continue;
      for (const field of PAGE_FIELDS) {
        if (page[field] === undefined) continue;
        addRecord(records, {
          ...common,
          pageUrl: page.url,
          evidenceType: `page:${field}`,
          observedValue: page[field],
          normalizedValue: stable(page[field]),
          scope: "page",
          device: page.device || null,
        });
      }
    }

    for (const field of ["domain", "platform", "schemaTypes", "services", "topicKeywords", "trust", "coverage", "sourceStatus"]) {
      if (evidence[field] === undefined) continue;
      addRecord(records, {
        ...common,
        evidenceType: `site:${field}`,
        observedValue: evidence[field],
        normalizedValue: stable(evidence[field]),
        scope: "website",
      });
    }
  }
  return records.sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

export default { projectEvidenceRecords };
