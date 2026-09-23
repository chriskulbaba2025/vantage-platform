# Semantic Retrieval Repair Freeze

Root cause: `SEMANTIC_RETRIEVAL_CONTRACT_FALSE_PASS` at base `10eafc716284168f222bb5e195b9cba82cd4e421`; repair attempt 1 of 3.

Required proof before closure:

1. Isolated pgvector PostgreSQL capability is directly proven (`vector` 0.8.6) and the application database with no extension is not mutated.
2. Migration 005 stores a pgvector `vector(1536)` column plus content hash/model/version and remains additive.
3. PostgreSQL lexical and semantic queries apply `tenant_id`, `audit_id`, and optional `website_id` in SQL before candidate return.
4. A controlled semantic fixture proves a query and evidence phrase with no important lexical token overlap retrieve the expected candidate; an unrelated negative control does not.
5. Lexical and vector paths are tested independently, then combined Ask composition is tested.
6. Vector candidates without canonical evidence produce no citation.
7. UNKNOWN/PARTIAL/CONFLICT/HISTORICAL/current semantics, tenant/audit/site isolation, bounded graph traversal, trace method labels, stale/content-hash behavior, and unavailable-vector deterministic/lexical fallback are proven.

Protected: canonical evidence, graph authority, report/scoring/lifecycle/auth, production resources, paid/live provider/model calls, Laya NO-GO.

Implementation boundary: migration 005, retrieval adapter/module, PostgreSQL and memory retrieval repository methods, Ask composition, orchestration indexing seam, focused tests, governance/proof artifacts. No unrelated dependency churn.
