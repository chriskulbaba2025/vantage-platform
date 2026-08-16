# PRYSM-NEXT-01 — Capability Evidence Matrix (WP-C)

**Contract:** capability-evidence.schema.json ($id …/contracts/v1/capability-evidence.schema.json, contractVersion 1.0.0, capabilityEvidenceVersion 2.0.0)
**Engine:** services/worker/src/evidence/capability-evidence.js (buildCapabilityEvidence)
**Governing rule:** unknown ≠ absent. Statuses are derived only from explicit evidence markers; nothing is converted to false/0/[]/{} on score-bearing paths.

## Status derivation per capability

| Capability | AVAILABLE | PARTIAL | UNAVAILABLE | FAILED | Provenance |
|---|---|---|---|---|---|
| content.body | contentParsing requested>0 ∧ failed=0 ∧ completed=requested; or `_contentEvidenceAvailable===true` (legacy crawler body text) | 0<completed<requested | requested>0 ∧ completed=0; or `_contentEvidenceAvailable===false`; or marker undefined (unknown) | — | dataforseo-onpage + adapterVersion |
| offer.clarity | `_contentEvidenceAvailable===true` | — | false or undefined marker | — | dataforseo-onpage |
| trust.proof | `_contentEvidenceAvailable===true` | — | false or undefined marker | — | dataforseo-onpage |
| conversion.cta | `_contentEvidenceAvailable===true` | — | false or undefined marker | — | dataforseo-onpage |
| conversion.form | `_contentEvidenceAvailable===true` | — | false or undefined marker | — | dataforseo-onpage |
| conversion.path | content evidence ∧ (ctas or forms present); kind=inferred, validated=false | — | content unavailable/unknown | — | dataforseo-onpage (WP-E upgrades kind/validated) |
| technical.indexability | nonIndexable requested>0 ∧ failed=0 (empty list = collected absence) | failed>0 | not collected | — | dataforseo-onpage |
| technical.redirects | redirectChains requested>0 ∧ failed=0 | 0<completed<requested; or page-level redirectDestination only | requested ∧ completed=0; not collected | — | dataforseo-onpage |
| technical.resources | resources requested>0 ∧ failed=0 | 0<completed<requested | requested ∧ completed=0; not collected | — | dataforseo-onpage |
| technical.headers | `_responseHeadersAvailable===true` | — | false or undefined | — | dataforseo-onpage |
| schema.structured_data | schemaTypes/microdataTypes non-empty; or content available (confirmed absence); or microdata acquisition completed (confirmed absence) | — | otherwise (empty arrays + unknown content are NOT treated as absence) | — | dataforseo-onpage |
| performance.lab | performance.sourceStatus AVAILABLE | PARTIAL | null evidence | FAILED | pagespeed (provider preserved) |
| performance.field | fieldData non-empty object | — | fieldData empty/absent (CrUX not populated) | — | pagespeed |

## Truth-table cases proven in capability-evidence.test.js

1. Full evidence (deep acquisitions + headers + performance + field data) → all 13 AVAILABLE; conversion.path kind=inferred, validated=false.
2. DFS metadata-only crawl (`_contentEvidenceAvailable=false`, all deep acquisitions failed for content) → content.* UNAVAILABLE; technical acquisitions still AVAILABLE; microdata-completed → schema AVAILABLE (absence confirmed); fieldData empty → performance.field UNAVAILABLE; requiredFieldsPresent=false for unavailable capabilities.
3. Partial content parsing (1/3) → content.body / technical.redirects / technical.resources PARTIAL.
4. No schema arrays + content unknown → schema.structured_data UNAVAILABLE (never false-absent).
5. No performance evidence → lab/field UNAVAILABLE.
6. Provider failure (performance FAILED) → lab FAILED, field UNAVAILABLE.
7. Conflicting signals (content parsing collected but page has no main content) → content.body AVAILABLE (collected per-page observation).
8. Malformed acquisition shape → degrades to UNAVAILABLE, never throws.
9. Determinism: identical evidence → deepEqual records.
10. Persistence: round-trip exact; schema-invalid persist rejected; corrupt artifact load rejected; schema-invalid load rejected.

## Capability → module mapping (consumed by WP-D scoring v4)

| Capability | Modules that require it |
|---|---|
| content.body | content_depth, funnel_coverage (content text), trust signal detection inputs |
| offer.clarity | offer_clarity |
| trust.proof | trust_signals |
| conversion.cta | conversion_paths (CTA evidence) |
| conversion.form | conversion_paths (form evidence) |
| conversion.path | conversion_paths (path validity tier) |
| technical.indexability | technical_hygiene (indexability rules) |
| technical.redirects | technical_hygiene (redirect rules) |
| technical.resources | technical_hygiene (broken-resource rules) |
| technical.headers | technical_hygiene (security-header rules), risk_reduction |
| schema.structured_data | schema_entity, ai_readiness |
| performance.lab | performance |
| performance.field | evidence confidence (field provenance only — never a score input) |
