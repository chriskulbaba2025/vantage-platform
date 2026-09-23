import { createHash } from "node:crypto";
import { buildRetrievalDocument, rankLexical, rankSemantic, tokenize } from "./hybrid-retrieval.js";
import { buildContextPack, buildRetrievalTrace, expandGovernedGraph } from "./retrieval-trace.js";

const QUESTION_PATTERNS = Object.freeze({ conflict: /\b(conflict(?:ing)?|contradict(?:ion|ory)?|disagree(?:ment)?|inconsistent)\b/i, missing: /\b(missing|unknown|not\s+justified|insufficient)\b/i, pages: /\b(which|what)\s+pages?\b|\bweak\s+(trust|proof)\b/i, support: /\b(evidence|supports?|why|recommendation)\b/i, developer: /\b(developer|fix\s+first|technical)\b/i });
function classify(question) { const value = String(question || "").trim(); for (const [type, pattern] of Object.entries(QUESTION_PATTERNS)) if (pattern.test(value)) return type; return "UNSUPPORTED"; }
function queryId({ tenantId, auditId, question }) { return createHash("sha256").update(JSON.stringify({ tenantId, auditId, question: String(question || "").trim() })).digest("hex").slice(0, 24); }
function deterministicMatches(evidence, question, questionType) { const terms = tokenize(question); return evidence.filter((item) => { if (questionType === "conflict") return item.conflict_state === "CONFLICT" || item.status === "CONFLICT"; if (questionType === "missing") return ["UNKNOWN", "UNAVAILABLE", "PARTIAL", "FAILED"].includes(item.status); if (questionType === "pages") return item.page_url && /trust|proof|testimonial|credential/i.test(`${item.evidence_type} ${item.page_url}`); if (questionType === "support" || questionType === "developer") return item.status !== "UNKNOWN"; return terms.some((term) => tokenize(`${item.evidence_type} ${item.page_url} ${item.source} ${item.observed_value}`).includes(term)) && item.status !== "UNKNOWN"; }).sort((a, b) => String(a.evidence_id).localeCompare(String(b.evidence_id))).slice(0, 50); }

/** Governed hybrid retrieval. Similarity ranks relevance only; canonical rows remain authoritative. */
export async function queryAskPrysm({ repository, tenantId, auditId, websiteId = null, question, embeddingAdapter } = {}) {
  if (!repository || typeof repository.listEvidence !== "function") throw new Error("Ask PRYSM evidence repository is required");
  if (!tenantId || !auditId) throw new Error("tenantId and auditId are required");
  const value = String(question || "").trim(); const type = classify(value); const id = queryId({ tenantId, auditId, question: value }); const scope = { tenantId, auditId, websiteId };
  const evidence = await repository.listEvidence({ tenantId, auditId });
  const deterministic = deterministicMatches(evidence, value, type);
  if (type === "UNSUPPORTED") return { contractVersion: "2.0.0", supported: false, questionType: type, answer: "This question is not supported by the governed evidence query layer yet.", citations: [], limitations: ["No governed retrieval contract matched the question."], contextPack: null, trace: buildRetrievalTrace({ queryId: id, scope, query: value, evidence: [], embeddingStatus: embeddingAdapter ? { status: "AVAILABLE" } : { status: "NOT_CONFIGURED" } }) };
  let documents = typeof repository.listRetrievalDocuments === "function" ? await repository.listRetrievalDocuments({ tenantId, auditId, websiteId }) : [];
  if (!documents.length) documents = evidence.map((item) => buildRetrievalDocument({ ...item, evidenceId: item.evidence_id, pageUrl: item.page_url, evidenceType: item.evidence_type, observedValue: item.observed_value, conflictState: item.conflict_state })).filter(Boolean);
  const allowedByQuestion = (item) => type === "conflict"
    ? item.conflictState === "CONFLICT" || item.status === "CONFLICT"
    : type === "missing"
      ? ["UNKNOWN", "UNAVAILABLE", "PARTIAL", "FAILED"].includes(item.status)
      : item.status !== "UNKNOWN";
  const lexical = (typeof repository.searchLexical === "function"
    ? await repository.searchLexical({ tenantId, auditId, websiteId, query: value, limit: 20 })
    : rankLexical(documents, value, 20)).filter(allowedByQuestion);
  let semantic = [];
  let embeddingStatus = embeddingAdapter ? { status: "AVAILABLE", modelVersion: embeddingAdapter.modelVersion || null } : { status: "NOT_CONFIGURED" };
  const retrievalLimitations = [];
  if (embeddingAdapter?.embed) {
    try {
      const queryVector = await embeddingAdapter.embed(value);
      semantic = (typeof repository.searchSemantic === "function"
        ? await repository.searchSemantic({ tenantId, auditId, websiteId, queryVector, limit: 20 })
        : rankSemantic(documents, value, { embeddingAdapter: { embed: () => queryVector }, limit: 20 })).filter(allowedByQuestion);
    } catch (error) {
      embeddingStatus = { status: "FAILED", category: error?.category || "unavailable", modelVersion: embeddingAdapter.modelVersion || null };
      retrievalLimitations.push("Semantic embedding retrieval was unavailable; deterministic and lexical retrieval remained active.");
    }
  }
  const graph = await expandGovernedGraph({ repository, tenantId, auditId, seedNodeIds: [...new Set([...lexical, ...semantic].map((item) => item.graphNodeId).filter(Boolean))], maxDepth: 2, maxNodes: 50 });
  const selectedEvidenceIds = new Set([...deterministic, ...lexical, ...semantic].map((item) => item.evidenceId || item.evidence_id).filter(Boolean));
  const groundedEvidence = evidence.filter((item) => selectedEvidenceIds.has(item.evidence_id));
  const excluded = documents.filter((item) => !selectedEvidenceIds.has(item.evidenceId) && !selectedEvidenceIds.has(item.documentId)).slice(0, 20).map((item) => ({ documentId: item.documentId, reason: "not-ranked-or-outside-bounded-pack" }));
  const contextPack = buildContextPack({ queryId: id, scope, query: value, deterministic, lexical, semantic, graph, evidence: groundedEvidence, excluded });
  const trace = buildRetrievalTrace({ queryId: id, scope, query: value, deterministic, lexical, semantic, graph, evidence: groundedEvidence, excluded, embeddingStatus });
  const citations = groundedEvidence.slice(0, 50).map((item) => ({ evidenceId: item.evidence_id, pageUrl: item.page_url, evidenceType: item.evidence_type, status: item.status, conflictState: item.conflict_state }));
  const answer = citations.length ? `${citations.length} governed evidence record(s) matched this question. Similarity was used only to retrieve candidates; review the cited source, status, and conflict state before acting.` : "The governed evidence authority does not contain enough evidence to answer this question. No negative conclusion is inferred.";
  return { contractVersion: "2.0.0", supported: true, questionType: type, answer, citations, limitations: [...retrievalLimitations, ...(citations.length ? [] : ["Evidence is missing, unavailable, partial, or outside the supported query scope."])], contextPack, trace };
}
export default { queryAskPrysm };
