import { createHash } from "node:crypto";

const UNCERTAIN_STATUSES = new Set(["UNKNOWN", "UNAVAILABLE", "FAILED", "BLOCKED", "NOT_COLLECTED"]);
const NEGATIVE_STATUSES = new Set(["ABSENT", "NOT_DETECTED", "NEGATIVE"]);

function text(value) { return value === null || value === undefined ? "" : String(value); }
function stable(value) { return JSON.stringify(value, Object.keys(value || {}).sort()); }
function idFor(value) { return createHash("sha256").update(stable(value)).digest("hex").slice(0, 32); }

function observationValue(record) {
  if (Object.prototype.hasOwnProperty.call(record, "normalizedValue")) return record.normalizedValue;
  return record.observedValue;
}

function semanticKey(record) {
  return [
    text(record.tenantId), text(record.clientId), text(record.auditId),
    text(record.websiteId), text(record.pageUrl), text(record.evidenceType),
    text(record.device), text(record.scope), text(record.dimension),
  ].join("|");
}

function isHistorical(record) {
  return String(record.temporalContext || record.currentness || "").toUpperCase() === "HISTORICAL";
}

/**
 * Reconcile record-level observations without destructive overwrites.
 * Unknown evidence never becomes negative evidence and conflicts fail closed.
 */
export function reconcileCanonicalEvidence(records = [], { now = null } = {}) {
  const groups = new Map();
  const rejected = [];
  for (const raw of Array.isArray(records) ? records : []) {
    if (!raw || typeof raw !== "object" || !raw.evidenceType) {
      rejected.push({ record: raw, reason: "missing evidenceType" });
      continue;
    }
    const record = {
      ...raw,
      status: text(raw.status || raw.sourceStatus || "UNKNOWN").toUpperCase(),
      observedAt: raw.observedAt || now || null,
      normalizedValue: observationValue(raw),
      evidenceId: raw.evidenceId || idFor({
        tenantId: raw.tenantId, clientId: raw.clientId, auditId: raw.auditId,
        websiteId: raw.websiteId, pageUrl: raw.pageUrl, evidenceType: raw.evidenceType,
        source: raw.source, providerArtifactRef: raw.providerArtifactRef,
        observedAt: raw.observedAt, observedValue: raw.observedValue,
      }),
    };
    const key = semanticKey(record);
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }

  const reconciled = [];
  for (const [key, observations] of groups.entries()) {
    const known = observations.filter((item) => !UNCERTAIN_STATUSES.has(item.status));
    const values = [...new Map(known.map((item) => [stable(item.normalizedValue), item.normalizedValue])).values()];
    const current = known.filter((item) => !isHistorical(item));
    const historical = known.filter(isHistorical);
    const temporalConflict = current.length > 0 && historical.length > 0 && current.some((item) =>
      historical.some((old) => stable(old.normalizedValue) !== stable(item.normalizedValue)));
    const conflict = values.length > 1 || temporalConflict;
    const statuses = [...new Set(observations.map((item) => item.status))].sort();
    const state = conflict
      ? "CONFLICT"
      : known.length === 0
        ? "UNKNOWN"
        : observations.some((item) => item.status === "PARTIAL")
          ? "PARTIAL"
          : values.length === 1 && NEGATIVE_STATUSES.has(known[0].status)
            ? "NEGATIVE"
            : "OBSERVED";
    reconciled.push({
      reconciliationId: idFor({ key }),
      semanticKey: key,
      state,
      authorityValue: conflict || values.length !== 1 ? null : values[0],
      observations: observations.slice().sort((a, b) => text(a.evidenceId).localeCompare(text(b.evidenceId))),
      statuses,
      conflict: {
        present: conflict,
        valueCount: values.length,
        temporalConflict,
      },
      provenance: [...new Set(observations.map((item) => item.source).filter(Boolean))].sort(),
      freshness: {
        latestObservedAt: observations.map((item) => item.observedAt).filter(Boolean).sort().at(-1) || null,
        currentObservationPresent: current.length > 0,
        historicalObservationPresent: historical.length > 0,
      },
    });
  }

  return {
    contractVersion: "1.0.0",
    records: reconciled.sort((a, b) => a.semanticKey.localeCompare(b.semanticKey)),
    rejected,
    counts: {
      input: Array.isArray(records) ? records.length : 0,
      reconciled: reconciled.length,
      conflicts: reconciled.filter((item) => item.conflict.present).length,
      unknown: reconciled.filter((item) => item.state === "UNKNOWN").length,
    },
  };
}

export default { reconcileCanonicalEvidence };
