import { createHash } from "node:crypto";

const ASSERTION_MODES = new Set(["OBSERVED", "INFERRED", "HYPOTHESIS"]);
const FORBIDDEN_CAUSAL_TYPES = new Set(["CAUSES", "CAUSALLY_DRIVES", "PROVES_REVENUE_LOSS"]);

function idFor(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32); }
function nodeId(tenantId, nodeType, stableKey) { return idFor({ tenantId, nodeType, stableKey }); }
function edgeId(tenantId, auditId, from, to, type) { return idFor({ tenantId, auditId, from, to, type }); }

export function buildEvidenceGraph({ tenantId, clientId = null, auditId, websiteId, websiteUrl, pages = [], evidenceRecords = [], findings = [], recommendations = [] } = {}) {
  if (!tenantId || !auditId) throw new Error("tenantId and auditId are required");
  const nodes = new Map();
  const edges = new Map();
  const addNode = (node) => {
    const normalized = { assertionMode: "OBSERVED", attributes: {}, ...node };
    if (!ASSERTION_MODES.has(normalized.assertionMode)) throw new Error(`Invalid node assertion mode: ${normalized.assertionMode}`);
    const id = normalized.nodeId || nodeId(tenantId, normalized.nodeType, normalized.stableKey);
    nodes.set(id, { ...normalized, nodeId: id, tenantId, clientId, auditId });
    return id;
  };
  const addEdge = (edge) => {
    const normalized = { assertionMode: "OBSERVED", evidenceIds: [], attributes: {}, ...edge };
    if (!ASSERTION_MODES.has(normalized.assertionMode)) throw new Error(`Invalid edge assertion mode: ${normalized.assertionMode}`);
    if (FORBIDDEN_CAUSAL_TYPES.has(normalized.edgeType) && normalized.causalContractSatisfied !== true) return null;
    if (normalized.assertionMode !== "OBSERVED" && normalized.evidenceIds.length === 0) return null;
    const id = normalized.edgeId || edgeId(tenantId, auditId, normalized.fromNodeId, normalized.toNodeId, normalized.edgeType);
    edges.set(id, { ...normalized, edgeId: id, tenantId, clientId, auditId });
    return id;
  };

  const websiteNode = addNode({ nodeType: "Website", stableKey: websiteId || websiteUrl, label: websiteUrl || websiteId });
  for (const page of pages) {
    if (!page?.url) continue;
    const pageNode = addNode({ nodeType: "Page", stableKey: page.url, label: page.title || page.url, attributes: { role: page.role || null } });
    addEdge({ fromNodeId: websiteNode, toNodeId: pageNode, edgeType: "CONTAINS" });
  }
  for (const evidence of evidenceRecords) {
    if (!evidence?.evidenceId) continue;
    const evidenceNode = addNode({ nodeType: "EvidenceRecord", stableKey: evidence.evidenceId, label: evidence.evidenceType, attributes: { status: evidence.status, conflictState: evidence.conflictState || "NONE" } });
    const pageNode = evidence.pageUrl ? nodes.get(nodeId(tenantId, "Page", evidence.pageUrl)) : null;
    if (pageNode) addEdge({ fromNodeId: pageNode.nodeId, toNodeId: evidenceNode, edgeType: "SUPPORTED_BY", evidenceIds: [evidence.evidenceId] });
  }
  for (const finding of findings) {
    if (!finding?.findingId) continue;
    const findingNode = addNode({ nodeType: "Finding", stableKey: finding.findingId, label: finding.title, assertionMode: finding.assertionMode || "OBSERVED" });
    for (const evidenceId of finding.evidenceIds || []) {
      const evidenceNode = nodes.get(nodeId(tenantId, "EvidenceRecord", evidenceId));
      if (evidenceNode) addEdge({ fromNodeId: findingNode, toNodeId: evidenceNode.nodeId, edgeType: "SUPPORTED_BY", evidenceIds: [evidenceId] });
    }
    if (finding.mapsToCanonicalProblemId) {
      const problemNode = addNode({ nodeType: "CanonicalProblem", stableKey: finding.mapsToCanonicalProblemId, label: finding.mapsToCanonicalProblemId });
      addEdge({ fromNodeId: findingNode, toNodeId: problemNode, edgeType: "MAPS_TO", evidenceIds: finding.evidenceIds || [], assertionMode: finding.assertionMode || "OBSERVED" });
    }
  }
  for (const recommendation of recommendations) {
    if (!recommendation?.recommendationId) continue;
    const recNode = addNode({ nodeType: "Recommendation", stableKey: recommendation.recommendationId, label: recommendation.title, assertionMode: recommendation.assertionMode || "OBSERVED" });
    for (const findingId of recommendation.findingIds || []) {
      const findingNode = nodes.get(nodeId(tenantId, "Finding", findingId));
      if (findingNode) addEdge({ fromNodeId: recNode, toNodeId: findingNode.nodeId, edgeType: "ADDRESSES", evidenceIds: recommendation.evidenceIds || [], assertionMode: recommendation.assertionMode || "OBSERVED" });
    }
  }
  return { contractVersion: "1.0.0", tenantId, clientId, auditId, nodes: [...nodes.values()], edges: [...edges.values()] };
}

export { nodeId, edgeId };
export default { buildEvidenceGraph };
