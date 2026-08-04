# Prysm File Disposition Appendix

**Document:** WP1-05  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Purpose:** File-level completeness — every relevant source, test, script, schema, workflow-related and persistence file with exactly one classification.

---

## Classification Key

| Code | Meaning |
|---|---|
| **KEEP** | Contract-compliant; no changes required during rebuild |
| **REFACTOR** | Functional but needs boundary/contract/placement adjustments |
| **REPLACE** | Does not meet governance contracts; must be rebuilt |
| **REMOVE** | Superseded, misplaced, or obsolete |
| **UNVERIFIED** | Behavior could not be confirmed without live environment |

---

## Source Files

### Entry Points and Configuration

| # | File | Classification | Reason |
|---|---|---|---|
| 1 | `services/worker/src/server.js` | REFACTOR | API + worker in single process; no graceful shutdown/logging; slug scanning over local dirs |
| 2 | `services/worker/src/config.js` | KEEP | Clean env-var loader with defaults, type coercion, and clamping |
| 3 | `services/worker/src/utils.js` | KEEP | Well-tested shared utilities; no changes needed |
| 4 | `services/worker/package.json` | KEEP | Correct dependencies; test scripts well-structured |

### Audit Orchestration

| # | File | Classification | Reason |
|---|---|---|---|
| 5 | `services/worker/src/audit/run-audit.js` | REFACTOR | Well-structured orchestrator; needs full lifecycle states + buildEvidenceEnvelope usage |
| 6 | `services/worker/src/audit/review-gate.js` | REFACTOR | State machine is correct but incomplete (3 of 12+ states); needs expansion |
| 7 | `services/worker/src/runners/run-audit.js` | KEEP | Simple CLI shim; no changes needed |

### DataForSEO On-Page

| # | File | Classification | Reason |
|---|---|---|---|
| 8 | `services/worker/src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.js` | REFACTOR | Comprehensive adapter; direct fs.writeFile at L1307-1345 must be removed |
| 9 | `services/worker/src/adapters/dataforseo-onpage/dataforseo-onpage-client.js` | KEEP | Well-isolated HTTP client; clean fixture/live split; good error categorization |

### DataForSEO Backlinks

| # | File | Classification | Reason |
|---|---|---|---|
| 10 | `services/worker/src/adapters/dataforseo-backlinks/dataforseo-backlinks-client.js` | KEEP | Isolated HTTP client; fixture/live modes |
| 11 | `services/worker/src/adapters/dataforseo-backlinks/backlink-adapter.legacy.js` | REMOVE | Misnamed test file; relocate test content, delete misleading filename |
| 12 | `services/worker/src/adapters/dataforseo-backlinks/backlink-artifact-writer.js` | REFACTOR | Delegates to artifact-store.js; should use primary report-store instead |
| 13 | `services/worker/src/adapters/dataforseo-backlinks/backlink-classifier.js` | KEEP | Deterministic rule-based classification; no changes needed |
| 14 | `services/worker/src/adapters/dataforseo-backlinks/backlink-normalizer.js` | KEEP | Resilient normalization with missing-field tolerance; no changes needed |
| 15 | `services/worker/src/adapters/dataforseo-backlinks/backlink-test-fixtures.json` | KEEP | Test fixture data; no changes needed |

### DataForSEO SERP

| # | File | Classification | Reason |
|---|---|---|---|
| 16 | `services/worker/src/adapters/dataforseo-serp/dataforseo-serp-client.js` | KEEP | Cleanest adapter; never throws; structured error objects; no persistence |
| 17 | `services/worker/src/adapters/dataforseo-serp/locale-normalizer.js` | KEEP | Clean utility; fallback transparency; no changes needed |
| 18 | `services/worker/src/adapters/dataforseo-serp/location-resolver.js` | KEEP | Clean utility; explicit error on failure; no changes needed |

### Evidence Providers

| # | File | Classification | Reason |
|---|---|---|---|
| 19 | `services/worker/src/evidence/pagespeed-client.js` | REFACTOR | Robust fallback chain; manages own cache/screenshots outside artifact store |
| 20 | `services/worker/src/evidence/ga4-client.js` | REFACTOR | Correct auth; no retry logic; parseServiceAccount duplicated |
| 21 | `services/worker/src/evidence/gsc-client.js` | REFACTOR | Good two-window design; no retry; duplicated auth; status semantics |
| 22 | `services/worker/src/evidence/backlinks-provider.js` | REFACTOR | Throws on failure instead of FAILED envelope; no PARTIAL pathway |
| 23 | `services/worker/src/evidence/competitor-opportunity-layer.js` | REFACTOR | Good qualification logic; status always AVAILABLE regardless of sourceStatus |
| 24 | `services/worker/src/evidence/internal-link-opportunity.js` | REMOVE | Relocate to scoring/reporting — pure computation, not evidence collection |
| 25 | `services/worker/src/evidence/site-crawler.js` | REFACTOR | Functional; only returns AVAILABLE; throws on zero pages; should retire for DataForSEO |
| 26 | `services/worker/src/evidence/page-extractor.js` | REMOVE | Relocate to lib/parser — HTML parsing utility, not evidence collector |
| 27 | `services/worker/src/evidence/screenshot-artifact.js` | REMOVE | Relocate to storage/ — artifact persistence utility, not evidence collector |

### Scoring

| # | File | Classification | Reason |
|---|---|---|---|
| 28 | `services/worker/src/scoring/vantage-score.js` | KEEP | Well-structured scoring orchestrator; deterministic; correct gating |
| 29 | `services/worker/src/scoring/score-components.js` | KEEP | Dimensions, modules, findings all well-defined; evidence-enforced; no changes needed |
| 30 | `services/worker/src/scoring/evidence-contracts.js` | KEEP | Canonical vocabulary; well-designed boundary validators; no changes needed |
| 31 | `services/worker/src/scoring/diagnostic-contracts.js` | KEEP | 22 diagnostic codes with client+technical explanations; no changes needed |
| 32 | `services/worker/src/scoring/rendering-diagnostics.js` | KEEP | 19 ordered classification rules; self-evaluation; no changes needed |
| 33 | `services/worker/src/scoring/report-model.js` | KEEP | Display model builders; pure functions; no changes needed |
| 34 | `services/worker/src/scoring/report-finalization-gate.js` | REFACTOR | Gate doesn't block rendering on failure; duplicate confidence formula |

### Report Rendering

| # | File | Classification | Reason |
|---|---|---|---|
| 35 | `services/worker/src/report/render-report.js` | REFACTOR | Functional; reads raw model.evidence.*; no ReportViewModel |
| 36 | `services/worker/src/report/render-approved-report.js` | REFACTOR | 15-page report; reads raw evidence; inlined CSS not hash-locked |
| 37 | `services/worker/src/report/html-helpers.js` | KEEP | Clean formatting utilities; no changes needed |
| 38 | `services/worker/src/report/sections-conversion.js` | REFACTOR | Good display logic; reads raw evidence directly |
| 39 | `services/worker/src/report/sections-trust.js` | REFACTOR | Good display logic; reads raw evidence directly |
| 40 | `services/worker/src/report/sections-seo.js` | REFACTOR | Good display logic; reads raw evidence directly |
| 41 | `services/worker/src/report/sections-performance.js` | REFACTOR | Good display logic; reads raw evidence directly; section number inconsistency |
| 42 | `services/worker/src/report/sections-internal-links.js` | REFACTOR | Good display logic; reads raw evidence directly |
| 43 | `services/worker/src/report/verify-template.js` | KEEP | CSS/JS hash lock verification; no changes needed |
| 44 | `services/worker/src/report/karen-leslie-template.html` | KEEP | Locked report design; must not change during rebuild |

### n8n Boundary

| # | File | Classification | Reason |
|---|---|---|---|
| 45 | `services/worker/src/n8n/prepare-payload.js` | KEEP | Correct compaction logic; strips all raw provider data; bounded |
| 46 | `services/worker/src/n8n/build-report.js` | UNVERIFIED | Could not verify without n8n environment; hardcoded /tmp paths |
| 47 | `services/worker/src/n8n/generate-zip.js` | UNVERIFIED | Could not verify ZIP integrity without n8n environment |
| 48 | `services/worker/src/n8n/prysm-n8n-workflow.json` | UNVERIFIED | Could not verify GPT-5.5 behavior/cost without live run; duplicate compaction |
| 49 | `services/n8n/vantage-audit-orchestration.json` | KEEP | Clean 4-node webhook workflow; no changes needed |

### Storage

| # | File | Classification | Reason |
|---|---|---|---|
| 50 | `services/worker/src/storage/report-store.js` | REPLACE | Functional but not unified ArtifactStore; missing interface contract; local FS default |
| 51 | `services/worker/src/storage/artifact-store.js` | REPLACE | Legacy store; parallel to report-store; local-only; no verification |
| 52 | `services/worker/src/storage/s3-artifact-store.js` | REPLACE | Legacy S3; separate from report-store; no unified interface |
| 53 | `services/worker/src/storage/transaction-helpers.js` | KEEP | SHA-256, txId, integrity checks; no changes needed |

### Auth

| # | File | Classification | Reason |
|---|---|---|---|
| 54 | `services/worker/src/auth/oauth-service.js` | KEEP | Complete OAuth flow; CSRF protection; read-only scopes; no changes needed |
| 55 | `services/worker/src/auth/token-store.js` | KEEP | AES-256-GCM encryption; memory + disk; platform-aware; no changes needed |

---

## Test Files

| # | File | Classification | Reason |
|---|---|---|---|
| 56 | `services/worker/src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.test.js` | KEEP | ~50 tests; mock fetchImpl; comprehensive coverage |
| 57 | `services/worker/src/adapters/dataforseo-serp/locale-normalizer.test.js` | KEEP | Unit tests for locale normalization |
| 58 | `services/worker/src/adapters/dataforseo-serp/location-resolver.test.js` | KEEP | Unit tests for location resolution |
| 59 | `services/worker/src/adapters/dataforseo-serp/serp-production-path.test.js` | KEEP | Production path tests; mock-based |
| 60 | `services/worker/src/adapters/dataforseo-serp/serp-query-failure-aggregation.test.js` | KEEP | Failure aggregation tests |
| 61 | `services/worker/src/audit/run-audit.test.js` | KEEP | Complete lifecycle tests; DI-based; comprehensive |
| 62 | `services/worker/src/audit/review-gate.test.js` | KEEP | Review gate tests |
| 63 | `services/worker/src/audit/approved-pages.test.js` | KEEP | Approved pages tests |
| 64 | `services/worker/src/audit/competitor-review.test.js` | KEEP | Competitor review tests |
| 65 | `services/worker/src/audit/per-audit-properties.test.js` | KEEP | Per-audit property tests |
| 66 | `services/worker/src/audit/production-path-integration.test.js` | KEEP | Integration tests; mock-based |
| 67 | `services/worker/src/scoring/vantage-score.test.js` | KEEP | Comprehensive scoring tests; determinism verified |
| 68 | `services/worker/src/scoring/rendering-diagnostics.test.js` | KEEP | Diagnostic classification tests |
| 69 | `services/worker/src/scoring/report-finalization-gate.test.js` | KEEP | Gate validation tests |
| 70 | `services/worker/src/report/render-report.test.js` | KEEP | Template hash, section IDs, navigation, print, keyboard |
| 71 | `services/worker/src/report/serp-partial-rendering.test.js` | KEEP | SERP partial rendering tests |
| 72 | `services/worker/src/evidence/pagespeed-client.test.js` | KEEP | Comprehensive fallback chain tests |
| 73 | `services/worker/src/evidence/backlinks-provider.test.js` | KEEP | Backlink provider tests |
| 74 | `services/worker/src/evidence/gsc-client.test.js` | KEEP | GSC client tests |
| 75 | `services/worker/src/evidence/site-crawler.test.js` | KEEP | Site crawler tests |
| 76 | `services/worker/src/evidence/screenshot-artifact.test.js` | KEEP | Screenshot artifact tests |
| 77 | `services/worker/src/evidence/competitor-opportunity-layer.test.js` | KEEP | Competitor opportunity tests |
| 78 | `services/worker/src/evidence/internal-link-opportunity.test.js` | KEEP | Internal link tests |
| 79 | `services/worker/src/storage/authoritative-committed-state.test.js` | KEEP | Committed state authority tests |
| 80 | `services/worker/src/storage/re-review-integrity.test.js` | KEEP | Re-review integrity tests |
| 81 | `services/worker/src/storage/s3-transaction.test.js` | KEEP | S3 transaction tests |
| 82 | `services/worker/src/storage/transaction-atomicity.test.js` | KEEP | Transaction atomicity tests |
| 83 | `services/worker/src/storage/transaction-integrity.test.js` | KEEP | Transaction integrity tests |
| 84 | `services/worker/src/auth/token-store.test.js` | KEEP | Token store tests |
| 85 | `services/worker/src/n8n/prepare-payload.test.js` | KEEP | Payload compaction tests |

---

## Scripts

| # | File | Classification | Reason |
|---|---|---|---|
| 86 | `services/worker/scripts/acceptance-task7.js` | KEEP | PageSpeed fallback acceptance; conditional live mode |
| 87 | `services/worker/scripts/acceptance-task9.js` | KEEP | Competitor acceptance; mock-only |
| 88 | `services/worker/scripts/acceptance-task10.js` | KEEP | Internal link acceptance; mock-only |
| 89 | `services/worker/scripts/run-backlink-adapter.js` | KEEP | Backlink runner; conditional live mode |
| 90 | `services/worker/scripts/run-blocked-acceptance.mjs` | REFACTOR | Requires Railway SSH; should use API-based verification |

---

## Configuration and Deployment

| # | File | Classification | Reason |
|---|---|---|---|
| 91 | `services/worker/Dockerfile` | KEEP | Clean Dockerfile; no changes needed |
| 92 | `services/worker/.env.example` | KEEP | Environment variable documentation |
| 93 | `.github/workflows/worker-ci.yml` | KEEP | Clean CI; no live calls; no changes needed |
| 94 | `railway.toml` | KEEP | Railway deployment config |
| 95 | `.gitignore` | KEEP | Appropriate exclusions |

---

## Documentation

| # | File | Classification | Reason |
|---|---|---|---|
| 96 | `CLAUDE.md` | KEEP | Project status document |
| 97 | `docs/Vantage_Production_PRD_v3.md` | KEEP | Authoritative specification |
| 98 | `docs/VANTAGE_END_TO_END_BUILD.md` | KEEP | Build documentation |
| 99 | `docs/PHASE_GATES.md` | KEEP | Phase gate documentation |
| 100 | `docs/prds/VANTAGE_BACKLINK_ADAPTER_PRD_V0_1.md` | KEEP | Backlink adapter PRD |
| 101 | `docs/prompts/BUILD_BACKLINK_ADAPTER_PHASE_1.md` | KEEP | Build prompt documentation |
| 102 | `docs/reports/*.md` (7 files) | KEEP | Historical postflight reports |
| 103 | `docs/reports/.gitkeep` | KEEP | Directory placeholder |

---

## Fixtures

| # | File | Classification | Reason |
|---|---|---|---|
| 104 | `services/worker/test-fixtures/rendering/may-crawford-no-lcp-fixture.json` | KEEP | Rendering test fixture |

---

## Artifacts

| # | File | Classification | Reason |
|---|---|---|---|
| 105 | `artifacts/local/backlink-tests/.gitkeep` | REMOVE | Generated artifact placeholder; charter prohibits committing |

---

## Classification Totals

| Classification | Count |
|---|---|
| **KEEP** | 74 |
| **REFACTOR** | 20 |
| **REPLACE** | 3 |
| **REMOVE** | 5 |
| **UNVERIFIED** | 3 |
| **TOTAL** | 105 |

Note: `node_modules/` entries excluded. `.claude/` and `docs/prysm-governance/` entries excluded (added by this WP). The 3 UNVERIFIED files are n8n integration scripts that require a live n8n environment to fully verify.
