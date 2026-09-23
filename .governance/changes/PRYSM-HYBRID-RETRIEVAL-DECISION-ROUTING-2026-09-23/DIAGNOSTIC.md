# Diagnostic Evidence

Classification: VERIFIED_DESIGN_GAP.

Direct evidence: `services/worker/src/evidence/ask-prysm-query.js` only classifies five deterministic question patterns and filters `listEvidence`; `004_evidence_graph.sql` has no retrieval-document or embedding storage; the PostgreSQL repository has no lexical/vector search or graph traversal method. The authenticated server route imports this query after authorization.

Protected authority: canonical evidence reconciliation, persisted evidence records, graph assertion modes, report projection, tenant authorization, and deterministic fallback.

Hypothesis: add a bounded retrieval index and query composition below the existing authorized Ask route; preserve the existing deterministic filter as the final fallback. Status: PROVEN.

Same-root repair attempts: 0.
