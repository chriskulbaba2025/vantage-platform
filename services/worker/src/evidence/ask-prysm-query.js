const QUESTION_PATTERNS = Object.freeze({
  conflict: /\b(conflict|contradict|disagree|inconsistent)\b/i,
  missing: /\b(missing|unknown|not\s+justified|insufficient)\b/i,
  pages: /\b(which|what)\s+pages?\b|\bweak\s+(trust|proof)\b/i,
  support: /\b(evidence|supports?|why|recommendation)\b/i,
  developer: /\b(developer|fix\s+first|technical)\b/i,
});

function classify(question) {
  const value = String(question || "").trim();
  for (const [type, pattern] of Object.entries(QUESTION_PATTERNS)) if (pattern.test(value)) return type;
  return "UNSUPPORTED";
}

/** Deterministic, read-only Ask PRYSM retrieval. No report/PDF RAG and no model call. */
export async function queryAskPrysm({ repository, tenantId, auditId, question } = {}) {
  if (!repository || typeof repository.listEvidence !== "function") throw new Error("Ask PRYSM evidence repository is required");
  if (!tenantId || !auditId) throw new Error("tenantId and auditId are required");
  const questionType = classify(question);
  const evidence = await repository.listEvidence({ tenantId, auditId });
  if (questionType === "UNSUPPORTED") {
    return { contractVersion: "1.0.0", supported: false, questionType, answer: "This question is not supported by the governed evidence query layer yet.", citations: [], limitations: ["No governed retrieval contract matched the question."], trace: { tenantId, auditId, evidenceCount: evidence.length } };
  }
  const matching = questionType === "conflict"
    ? evidence.filter((item) => item.conflict_state === "CONFLICT" || item.status === "CONFLICT")
    : questionType === "missing"
      ? evidence.filter((item) => ["UNKNOWN", "UNAVAILABLE", "PARTIAL", "FAILED"].includes(item.status))
      : questionType === "pages"
        ? evidence.filter((item) => item.page_url && /trust|proof|testimonial|credential/i.test(`${item.evidence_type} ${item.page_url}`))
        : evidence.filter((item) => item.status !== "UNKNOWN");
  const citations = matching.slice(0, 50).map((item) => ({ evidenceId: item.evidence_id, pageUrl: item.page_url, evidenceType: item.evidence_type, status: item.status, conflictState: item.conflict_state }));
  const answer = matching.length
    ? `${matching.length} governed evidence record(s) matched this question. Review the cited page, source, status, and conflict state before acting.`
    : "The governed evidence authority does not contain enough evidence to answer this question. No negative conclusion is inferred.";
  return { contractVersion: "1.0.0", supported: true, questionType, answer, citations, limitations: matching.length ? [] : ["Evidence is missing, unavailable, partial, or outside the supported query scope."], trace: { tenantId, auditId, evidenceCount: evidence.length, matchedCount: matching.length } };
}

export default { queryAskPrysm };
