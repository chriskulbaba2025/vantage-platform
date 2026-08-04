# Prysm WP1 Risk Register

**Document:** WP1-04  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Purpose:** Rank risks by likelihood, impact, detectability, report-design exposure, production exposure, and recommended control.

---

## Risk Matrix

| ID | Risk | L | I | D | RPN | Rpt | Prod | Control |
|---|---|---|---|---|---|---|---|---|
| R-WP1-001 | Local filesystem is default durable storage — container restart loses all evidence | 5 | 5 | 2 | 50 | LOW | CRITICAL | WP3: Artifact Store — make object storage the system of record |
| R-WP1-002 | Adapters write permanent artifacts directly, bypassing central store | 5 | 4 | 3 | 60 | LOW | HIGH | WP3+WP5: Remove adapter-owned writes; all persistence through ArtifactStore |
| R-WP1-003 | No ReportViewModel — renderers read raw provider payloads | 5 | 3 | 4 | 60 | HIGH | MEDIUM | WP2+WP10: Create ReportViewModel schema; lock renderer to it |
| R-WP1-004 | BLOCKED early-return path historically skipped raw artifact persistence (PR #29 fixed) | 3 | 5 | 2 | 30 | LOW | HIGH | WP5: Universal adapter contract enforces artifact write in ALL paths |
| R-WP1-005 | No database layer — lifecycle, review, and approval state in JSON files only | 4 | 4 | 3 | 48 | LOW | HIGH | WP4: State machine with database persistence |
| R-WP1-006 | n8n workflow makes 3× live GPT-5.5 calls per report with no hard budget enforcement in code | 4 | 3 | 3 | 36 | LOW | MEDIUM | WP9: Hard budget + replay mode default |
| R-WP1-007 | Report template CSS/JS hash-locked but section HTML unconstrained — renderers can inject arbitrary HTML/styles | 3 | 3 | 2 | 18 | HIGH | LOW | WP10: Lock renderer to validated view model; validate section output |
| R-WP1-008 | Static site crawler only returns AVAILABLE — no PARTIAL, BLOCKED, or FAILED pathways | 2 | 3 | 4 | 24 | LOW | LOW | WP6: Retire legacy crawler; universal adapter contract for all providers |
| R-WP1-009 | Backlinks provider throws on API failure instead of returning FAILED envelope | 3 | 2 | 3 | 18 | LOW | LOW | WP6: Universal adapter contract with structured error handling |
| R-WP1-010 | GA4 and GSC have zero retry logic — transient network errors kill collection | 3 | 2 | 4 | 24 | LOW | MEDIUM | WP5: Central retry policy in orchestrator |
| R-WP1-011 | Payload compaction logic duplicated (prepare-payload.js + n8n workflow inlined) | 3 | 2 | 2 | 12 | LOW | LOW | WP8: Single source of truth for compaction contract |
| R-WP1-012 | `build-report.js` hardcodes `/tmp` paths — Unix-only | 3 | 2 | 5 | 30 | MEDIUM | LOW | WP10: Remove hardcoded paths; use env vars or object storage |
| R-WP1-013 | `run-blocked-acceptance.mjs` requires Railway SSH access — cannot run in CI | 2 | 2 | 5 | 20 | LOW | LOW | WP5+WP12: Staging end-to-end acceptance without SSH |
| R-WP1-014 | `karen-leslie-template.html` CSS copy in `render-approved-report.js` not hash-locked | 2 | 4 | 3 | 24 | HIGH | LOW | WP10: Single template source; hash-lock both draft and approved paths |
| R-WP1-015 | No request logging, metrics, or graceful shutdown in server.js | 3 | 2 | 4 | 24 | NONE | LOW | Post-rebuild: operational hardening |
| R-WP1-016 | `parseServiceAccount` duplicated between ga4-client.js and gsc-client.js | 2 | 1 | 5 | 10 | NONE | LOW | WP6: Shared auth utility |
| R-WP1-017 | Competitor opportunity layer's `status` always `AVAILABLE` even when `sourceStatus` is `PARTIAL`/`NOT_CONNECTED` | 3 | 2 | 2 | 12 | LOW | LOW | WP6: Universal adapter contract — single status field |
| R-WP1-018 | `site-crawler.js` throws on zero pages instead of returning structured FAILED | 2 | 3 | 4 | 24 | LOW | LOW | WP6: Universal adapter contract |
| R-WP1-019 | `internal-link-opportunity.js` in `evidence/` directory but is pure computation, not an evidence collector | 1 | 1 | 5 | 5 | NONE | NONE | WP7: Move to scoring/reporting layer |
| R-WP1-020 | `page-extractor.js` in `evidence/` directory but is an HTML parsing utility | 1 | 1 | 5 | 5 | NONE | NONE | Reorganize: move to lib/parser |
| R-WP1-021 | `screenshot-artifact.js` in `evidence/` directory but is a storage utility | 2 | 2 | 5 | 20 | NONE | LOW | WP3: Integrate into ArtifactStore |
| R-WP1-022 | `backlink-adapter.legacy.js` is a test file with misleading name | 1 | 1 | 5 | 5 | NONE | NONE | Rename or relocate |

**Legend:**
- L = Likelihood (1-5, 5 = almost certain)
- I = Impact (1-5, 5 = critical)
- D = Detectability (1-5, 5 = immediately obvious)
- RPN = L × I × D (higher = more urgent)
- Rpt = Report-design exposure
- Prod = Production exposure

---

## Top 5 Risks (by RPN)

### #1 R-WP1-002: Adapter-owned permanent writes (RPN=60)

**Risk:** Five separate write paths bypass the central artifact store. Any change to storage must be coordinated across all five. If one path changes but not others, evidence fragmentation results.

**Governance contract:** 01 Charter §6.2 — Central artifact store. 03 Pipeline §4 — Artifact contract with unified key structure.

**Recommended control:** WP3 central ArtifactStore with all adapters returning provider bytes only; orchestrator persists via single store interface.

### #2 R-WP1-003: Renderers read raw provider payloads (RPN=60)

**Risk:** All 14 section renderers access `model.evidence.*` directly. A provider API change propagates through scoring AND rendering. The report design is not isolated from provider implementation details.

**Governance contract:** 02 Immutability §5 — Protected renderer boundary. 01 Charter §6.5 — Locked renderer.

**Recommended control:** WP2 ReportViewModel schema + WP10 lock renderer to validated view model only.

### #3 R-WP1-001: Local filesystem as default durable storage (RPN=50)

**Risk:** Default `artifactDir` is a relative local path. Container restart on Railway loses all evidence, lifecycle state, cached tokens, and reports. S3 is conditional — if unset, there is zero durability.

**Governance contract:** 01 Charter §4.5 — Object storage owns immutable copies. 01 Charter §3.4 — Retire Railway local disk as permanent storage.

**Recommended control:** WP3 make object storage the default system of record with local FS as development convenience only.

### #4 R-WP1-005: No database layer (RPN=48)

**Risk:** All lifecycle state, review records, and approval history stored as JSON files. No query capability, no concurrency control (beyond optimistic status check), no backup/restore, no audit trail.

**Governance contract:** 01 Charter §4.4 — Database owns audit identity, lifecycle state, score/cost summaries, approval records.

**Recommended control:** WP4 state machine with database persistence.

### #5 R-WP1-006: n8n makes 3× GPT-5.5 calls with no hard budget enforcement in code (RPN=36)

**Risk:** Each Prysm report generation calls GPT-5.5 three times. No hard budget enforcement in the n8n workflow — soft prompt rules may be bypassed. No mock/replay modes enforced at the n8n level.

**Governance contract:** 04 n8n/LLM §6 — Mock/replay default. §7 — Hard budget enforcement. §5 — Cheapest passing model.

**Recommended control:** WP9 implement hard budget, mock/replay modes, and cache policy.

---

## Report-Design Exposure Summary

| Risk ID | Exposure | Detail |
|---|---|---|
| R-WP1-003 | HIGH | 14 section renderers read raw evidence — any provider change can alter report content |
| R-WP1-007 | HIGH | Section HTML unconstrained; renderers can inject arbitrary styles |
| R-WP1-014 | HIGH | Multi-page CSS copy not hash-locked; drift risk between draft and approved |
| R-WP1-012 | MEDIUM | `/tmp` paths prevent report generation on non-Unix systems |

---

## Production Exposure Summary

| Risk ID | Exposure | Detail |
|---|---|---|
| R-WP1-001 | CRITICAL | Container restart = total data loss without S3 |
| R-WP1-002 | HIGH | Evidence to 5 different locations; no unified backup |
| R-WP1-004 | HIGH | BLOCKED path historically skipped artifact persistence |
| R-WP1-005 | HIGH | No database for production lifecycle management |
| R-WP1-006 | MEDIUM | LLM cost unbounded in production |
| R-WP1-010 | MEDIUM | GA4/GSC transient failures are terminal |
