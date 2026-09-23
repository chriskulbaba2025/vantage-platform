import { createHash } from "node:crypto";

const DIMENSIONS = 1536;
const SECRET_FIELD = /password|passwd|secret|token|api[_-]?key|credential|authorization|cookie|private[_-]?key/i;
const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "are", "what", "which", "how", "why"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function contentHash(value) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

export function tokenize(value) {
  return [...new Set(String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((word) => word && !STOP_WORDS.has(word)))].sort();
}

/** Test-only deterministic fixture. It is not semantic and is never a production default. */
export function deterministicTestEmbedding(text, dimensions = DIMENSIONS) {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of tokenize(text)) {
    const digest = createHash("sha256").update(token).digest();
    for (let i = 0; i < dimensions; i += 1) vector[i] += (digest[i % digest.length] / 255) * (digest[(i + 7) % digest.length] % 2 ? 1 : -1);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(8)));
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) return 0;
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const leftNorm = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0));
  return leftNorm && rightNorm ? dot / (leftNorm * rightNorm) : 0;
}

function safeText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return Object.entries(value).filter(([key]) => !SECRET_FIELD.test(key)).map(([key, item]) => `${key} ${safeText(item)}`).join(" ");
  return String(value);
}

export function buildRetrievalDocument(record, { embeddingAdapter = null } = {}) {
  const content = [record.label, record.evidenceType, record.pageUrl, record.title, record.description, record.text, record.observedValue, record.normalizedValue, record.source].map(safeText).join(" ").trim();
  if (!content || Object.keys(record).some((key) => SECRET_FIELD.test(key))) return null;
  const hash = contentHash(content);
  return {
    documentId: record.documentId || record.evidenceId || record.nodeId || contentHash({ scope: record.tenantId, audit: record.auditId, content }),
    tenantId: record.tenantId,
    clientId: record.clientId || null,
    websiteId: record.websiteId || null,
    auditId: record.auditId,
    graphNodeId: record.nodeId || null,
    evidenceId: record.evidenceId || null,
    nodeType: record.nodeType || "EvidenceRecord",
    source: record.source || record.provenance || "unknown",
    content,
    contentHash: hash,
    embedding: record.contentHash === hash && Array.isArray(record.embedding)
      ? record.embedding
      : embeddingAdapter?.embed ? embeddingAdapter.embed(content) : null,
    embeddingModel: record.contentHash === hash && Array.isArray(record.embedding)
      ? (record.embeddingModel || null)
      : (embeddingAdapter?.modelVersion || null),
    currentness: record.currentness || record.temporalContext || "CURRENT",
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    status: record.status || "UNKNOWN",
    conflictState: record.conflictState || record.conflict_state || "NONE",
    provenance: record.provenance || record.source || "unknown",
  };
}

export function rankLexical(documents, query, limit = 20) {
  const terms = tokenize(query);
  return documents.map((document) => {
    const docTerms = new Set(tokenize(document.content));
    const matchedTerms = terms.filter((term) => docTerms.has(term));
    return { ...document, score: terms.length ? matchedTerms.length / terms.length : 0, matchedTerms, retrievalMethod: "LEXICAL" };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId)).slice(0, limit);
}

export function rankSemantic(documents, query, { embeddingAdapter = null, limit = 20 } = {}) {
  if (!embeddingAdapter?.embed) return [];
  const queryVector = embeddingAdapter.embed(query);
  return documents.map((document) => ({ ...document, score: cosineSimilarity(queryVector, document.embedding), retrievalMethod: "SEMANTIC" }))
    .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId)).slice(0, limit);
}

export { SECRET_FIELD, DIMENSIONS };
