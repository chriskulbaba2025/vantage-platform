# Prysm Dependency Map

**Document:** WP1-03  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Purpose:** Identify circular dependencies, provider-specific leakage, adapter lifecycle control, permanent writes, raw payload consumers, renderer dependencies, n8n dependencies, database dependencies, and local-disk dependencies.

---

## 1. Dependency Graph (Module-Level)

```text
server.js
├── audit/run-audit.js ★ (central orchestrator)
│   ├── config.js
│   ├── utils.js
│   ├── evidence/site-crawler.js
│   │   ├── evidence/page-extractor.js
│   │   └── scoring/evidence-contracts.js
│   ├── adapters/dataforseo-onpage/dataforseo-onpage-adapter.js
│   │   ├── adapters/dataforseo-onpage/dataforseo-onpage-client.js
│   │   ├── scoring/evidence-contracts.js
│   │   └── utils.js
│   ├── evidence/pagespeed-client.js
│   │   ├── evidence/screenshot-artifact.js
│   │   ├── scoring/evidence-contracts.js
│   │   └── utils.js
│   ├── evidence/backlinks-provider.js
│   │   └── scoring/evidence-contracts.js
│   ├── evidence/ga4-client.js
│   │   └── scoring/evidence-contracts.js
│   ├── evidence/gsc-client.js
│   │   └── scoring/evidence-contracts.js
│   ├── evidence/competitor-opportunity-layer.js
│   │   ├── adapters/dataforseo-serp/dataforseo-serp-client.js
│   │   │   ├── adapters/dataforseo-serp/locale-normalizer.js
│   │   │   └── adapters/dataforseo-serp/location-resolver.js
│   │   └── scoring/evidence-contracts.js
│   ├── evidence/internal-link-opportunity.js
│   │   └── scoring/evidence-contracts.js
│   ├── scoring/vantage-score.js
│   │   ├── scoring/score-components.js
│   │   ├── scoring/evidence-contracts.js
│   │   ├── scoring/report-model.js
│   │   ├── scoring/rendering-diagnostics.js
│   │   │   └── scoring/diagnostic-contracts.js
│   │   └── utils.js
│   ├── scoring/report-finalization-gate.js
│   │   ├── scoring/evidence-contracts.js
│   │   └── scoring/diagnostic-contracts.js
│   ├── report/render-report.js
│   │   ├── report/sections-conversion.js
│   │   ├── report/sections-trust.js
│   │   ├── report/sections-seo.js
│   │   ├── report/sections-performance.js
│   │   │   └── evidence/screenshot-artifact.js
│   │   ├── report/sections-internal-links.js
│   │   ├── report/html-helpers.js
│   │   └── report/karen-leslie-template.html
│   ├── report/render-approved-report.js
│   │   └── (same section renderers)
│   ├── storage/report-store.js
│   │   └── storage/transaction-helpers.js
│   └── audit/review-gate.js
│       └── scoring/evidence-contracts.js
├── storage/report-store.js (direct)
├── auth/oauth-service.js
│   └── auth/token-store.js
└── config.js
```

---

## 2. Circular Dependencies

**None detected.** The dependency graph is a DAG (directed acyclic graph). All imports flow downward:

```
server.js → run-audit.js → evidence/adapters + scoring + report + storage
```

The closest to a cycle is `run-audit.js` importing from both `scoring/` and `report/`, with report renderers importing `scoring/evidence-contracts.js` for `SOURCE_STATUS` — but this is a shared constant module, not a circular dependency.

---

## 3. Provider-Specific Leakage

### 3.1 DataForSEO Leakage into Scoring

- `scoring/evidence-contracts.js` defines `ERROR_CATEGORY` with DataForSEO-specific categories (`rate_limit`, `auth`) — acceptable as these are generic HTTP concepts.
- `score-components.js` checks `site._contentEvidenceAvailable` and `site._responseHeadersAvailable` — these are private fields set ONLY by the DataForSEO onpage adapter. The legacy `site-crawler.js` does NOT set them. This means scoring behavior differs depending on which crawler ran.

### 3.2 DataForSEO Leakage into Report Sections

- `sections-conversion.js` reads `model.evidence.site._contentEvidenceAvailable` directly.
- `sections-performance.js` reads `model.evidence.performance.fallbackUsed`, `model.evidence.performance.intendedProvider`, `model.evidence.performance.source` — these are PageSpeed-specific fields leaked into the renderer.
- `sections-performance.js` reads SERP-specific fields: `competitorOpportunities.sources.dataforseoSerp.status`.

### 3.3 GA4/GSC Leakage

- `sections-performance.js` reads `model.evidence.ga4.sourceStatus`, `model.evidence.ga4.collectedAt` — provider-specific metadata visible in report.
- `sections-performance.js` reads `model.evidence.gsc.sourceStatus`, `model.evidence.gsc.sufficiency.sufficient`, `model.evidence.gsc.rows` — GSC row data exposed to renderer.
- `score-components.js` creates 3 GSC-specific findings (VAN-GSC-001/002/003) with direct GSC row inspection.

---

## 4. Adapters Controlling Lifecycle

**No adapter directly controls audit lifecycle state.** All state transitions go through `audit/review-gate.js` → `storage/report-store.js`. Evidence adapters return data envelopes with `sourceStatus` — the orchestrator decides what to do.

**Partial control concerns:**

| Module | Concern |
|---|---|
| `dataforseo-onpage-adapter.js` | Decides its own BLOCKED vs PARTIAL classification based on provider-specific fields (`forbidden_robots`, `start_page_deny_flag`). The orchestrator cannot override this classification. |
| `pagespeed-client.js` | Manages its own retry strategy, fallback chain, and cache TTL. The orchestrator cannot control retry behavior or disable caching. |
| `competitor-opportunity-layer.js` | Derives its own `sourceStatus` from SERP query outcomes + supplied competitor state. Complex multi-factor derivation that the orchestrator cannot override. |

---

## 5. Adapters Performing Permanent Writes

| Module | Write Location | Method | Bypasses Central Store? |
|---|---|---|---|
| `dataforseo-onpage-adapter.js` (L1307-1345) | `{artifactRoot}/raw/{artifactRunId}.json` | `fs.writeFile` via `mkdir` | YES |
| `pagespeed-client.js` (L25) | `{cacheDir}/` | `fs.writeFile` via `writeCache` | YES |
| `screenshot-artifact.js` (L307, L338) | `reports/{slug}/{runId}/evidence/screenshots/` | `fs.writeFile` via `persistScreenshot` | YES |
| `backlink-artifact-writer.js` | `{outPath}/raw-backlinks.json` etc. | Delegates to `artifact-store.js` | YES (uses legacy store, not report-store) |
| `token-store.js` | `{artifactDir}/tokens/token-{provider}.enc` | `fs.writeFile` | YES |

**Compliant writes (through central store):**
- `report-store.js` `writeReport()`, `commitCompetitorReview()`, `writeApprovedPages()` — all go through the primary store.

---

## 6. Raw Payload Consumers

| Consumer | What It Reads | Risk |
|---|---|---|
| `scoreAudit()` in `vantage-score.js` | `evidence.site`, `evidence.performance`, `evidence.gsc`, `evidence.ga4`, `evidence.backlinks` | MEDIUM — scoring reads normalized envelopes, not raw provider JSON |
| `buildFindings()` in `score-components.js` | `site.pages[]`, `site.trust.*`, `site.schemaTypes`, `site.pageCount`, `gsc.rows` | MEDIUM — findings trace to specific evidence fields |
| `renderReport()` — all 13 section renderers | `model.evidence.*` (site, performance, gsc, ga4, backlinks, competitorOpportunities) | HIGH — raw evidence fields directly templated into HTML |
| `prepare-payload.js` (n8n) | `audit.json` (the scored model) | LOW — explicitly strips raw provider payloads |
| `prysm-n8n-workflow.json` "Prepare GPT Payload" | Same as prepare-payload.js | LOW — same compaction, 100KB max |
| `render-approved-report.js` | `model.evidence.*` via section renderers | HIGH — same as renderReport |

---

## 7. Renderer Dependencies

### 7.1 render-report.js (single-page draft)

```
render-report.js
├── node:fs/promises (readFile for template)
├── node:path (dirname, resolve)
├── node:url (fileURLToPath)
├── report/html-helpers.js (e, severityClass, scoreCard, section, table, fmtSec, fmt)
├── report/sections-conversion.js (6 section renderers)
├── report/sections-trust.js (2 section renderers)
├── report/sections-seo.js (3 section renderers)
├── report/sections-performance.js (2 section renderers)
└── report/karen-leslie-template.html (locked CSS/JS design)
```

### 7.2 render-approved-report.js (15-page approved)

```
render-approved-report.js
├── node:fs/promises (readFile for template)
├── node:path (dirname, resolve)
├── node:url (fileURLToPath)
├── report/html-helpers.js
├── report/sections-conversion.js (6 renderers)
├── report/sections-trust.js (2 renderers)
├── report/sections-seo.js (3 renderers)
├── report/sections-performance.js (2 renderers)
├── report/sections-internal-links.js (1 renderer)
└── report/karen-leslie-template.html (inlined CSS copy — NOT hash-locked)
```

### 7.3 Section Renderer Evidence Dependencies

| Section | Evidence Fields Read |
|---|---|
| scorecard | `model.scores.*`, `model.bands.*`, `model.evidenceConfidenceScore`, `model.rootCause`, `model.evidence.site`, `model.evidence.performance`, `model.evidence.ga4`, `model._crawlSuppressed` |
| priorityFixes | `model.findings[].evidence[]`, `model.findings[].affectedUrls` |
| conversionPaths | `model.evidence.site.pages[]`, `model.evidence.site.trust` |
| readinessMap | `model.evidence.site.pages[]`, `model.evidence.site.services[]` |
| contentIdeas | `model.evidence.site.pages[]`, `model.evidence.site.topicKeywords[]` |
| competitorBenchmark | `model.evidence.site`, `model.competitors`, `model.competitorOpportunities` |
| eeat | `model.evidence.site.trust.*`, `model.evidence.site.schemaTypes[]` |
| cms | `model.evidence.site.platform`, `model.evidence.site.pages[0].responseHeaders` |
| technical | `model.evidence.site.pages[]`, `model.evidence.performance` |
| headings | `model.evidence.site.pages[0].headings` |
| schema | `model.evidence.site.schemaTypes[]`, `model.evidence.site.pages[]` |
| performance | `model.evidence.performance.*` (full envelope), `model.renderingDiagnostics` |
| appendix | `model.evidence.site`, `model.evidence.performance`, `model.evidence.backlinks`, `model.evidence.ga4`, `model.evidence.gsc` |
| internalLinks | `model.evidence.internalLinkOpportunities`, `model.evidence.site.brokenInternalLinks` |

**Key finding: Every section renderer reads `model.evidence.*` directly. No ReportViewModel abstraction exists.**

---

## 8. n8n Dependencies

### 8.1 n8n → Worker

```
vantage-audit-orchestration.json
  "Run Vantage Audit" node → HTTP POST to $VANTAGE_WORKER_URL/audits
  Header: x-vantage-secret: $VANTAGE_WEBHOOK_SECRET
  Timeout: 600s
```

### 8.2 n8n → Filesystem (for GPT report generation)

```
prysm-n8n-workflow.json
  "Validate Input" node → reads from VANTAGE_ARTIFACT_DIR/{slug}/{runId}/audit.json
  "Prepare GPT Payload" node → inlines duplicate compaction logic
  "Assemble Static HTML Report" node → inlines CSS + 5-page HTML
  "Generate Netlify ZIP" node → in-memory ZIP (no fs dependency)
```

### 8.3 Worker → n8n (scripts in src/n8n/)

```
prepare-payload.js → reads audit.json from local path, writes JSON to stdout
build-report.js → reads /tmp/vantage-report-input.json (hardcoded Unix path)
generate-zip.js → reads report directory, creates ZIP
```

**Duplicate logic risk:** Payload compaction exists in both `prepare-payload.js` AND inlined in `prysm-n8n-workflow.json` "Prepare GPT Payload" node. Constants (`MAX_FINDINGS=30`, `MAX_COMPETITORS=5`, etc.) could diverge.

---

## 9. Database Dependencies

**NONE.** The Prysm worker has zero database integration:

- No Supabase client
- No PostgreSQL connection
- No SQLite
- No Redis
- No ORM

All persistent state is stored as JSON files on the local filesystem or in S3:

- `lifecycle.json` — audit state, review, approval, artifacts list
- `audit.json` — scored model
- `evidence.json` — raw evidence envelope
- `manifest.json` — audit manifest
- `index.html` — rendered report

The governance charter (01 §4.4) specifies a database owning audit identity, lifecycle state, and score/cost summaries — this layer is entirely absent.

---

## 10. Local-Disk Dependencies

### 10.1 Default Configuration

```javascript
// config.js
artifactDir: resolve("artifacts/reports")  // DEFAULT: relative local path
```

### 10.2 All Local-Disk Paths

| Module | Path | Purpose |
|---|---|---|
| `report-store.js` (local) | `{artifactDir}/{slug}/{runId}/` | Primary report storage |
| `report-store.js` (local) | `{artifactDir}/{slug}/{runId}/lifecycle.json` | Lifecycle state |
| `report-store.js` (local) | `{artifactDir}/{slug}/{runId}/.txn/{txId}/` | Transaction staging |
| `artifact-store.js` | `artifacts/local/backlink-tests/` (default) | Backlink artifacts |
| `dataforseo-onpage-adapter.js` | `{artifactRoot}/raw/{artifactRunId}.json` | Raw crawl JSON |
| `pagespeed-client.js` | `{cacheDir}/` (default: `artifacts/cache/pagespeed/`) | PSI response cache |
| `screenshot-artifact.js` | `reports/{slug}/{runId}/evidence/screenshots/` | Screenshot JPEG + metadata |
| `token-store.js` | `{artifactDir}/tokens/token-{provider}.enc` | Encrypted OAuth tokens |
| `server.js` (slug scanning) | `readdir(config.artifactDir)` | Dynamic directory listing |
| `build-report.js` (n8n) | `/tmp/vantage-report-input.json` (HARDCODED) | n8n input |
| `build-report.js` (n8n) | `/tmp/vantage-report-output/` (HARDCODED) | n8n output |
| `prepare-payload.js` (n8n) | `process.argv[2]` (passed file path) | Input audit.json |

### 10.3 Production Impact

In Railway production, `artifactDir` resolves to a container-local path. When the container restarts or scales:
- All local-disk evidence is lost
- Lifecycle state is lost
- Cache is lost
- Encrypted tokens are lost

S3 support exists (`VANTAGE_REPORTS_BUCKET`) but is conditional and not the default. When S3 IS configured, only `report-store.js` path goes through S3 — the 5 direct `fs.writeFile` paths from adapters still write to local disk.

---

## 11. Critical Dependency Chains

### 11.1 Audit Creation Chain

```
POST /audits
→ server.js
→ runAudit(input, {config, oauthService})
→ createProductionCrawlProvider(config)
→ crawlWithDataforseo(targetUrl) OR notConnectedCrawlEnvelope(targetUrl)
→ Promise.all([performance, competitors, backlinks, ga4, gsc])
→ generateInternalLinkOpportunities(site, input)
→ collectCompetitorOpportunities(site, input)
→ validateAndDowngrade() × 5
→ scoreAudit(input, evidence)
→ runFinalizationGate(model, evidence)
→ renderReport(gatedModel, {artifactRoot})
→ store.writeReport({slug, runId, html, model, manifest})
→ return {runId, slug, status: "draft", ...}
```

### 11.2 Review Chain

```
POST /audits/:id/review
→ server.js
→ submitReview(store, slug, runId, payload)
→ store.readCommittedArtifacts(slug, runId)
→ validateCompetitorDecisions(decisions, knownCandidateUrls)
→ apply decisions in-memory
→ scoreAudit(model.input, evidence)  // re-score
→ buildReviewRecord(payload)
→ store.commitCompetitorReview({slug, runId, evidence, model, reviewRecord})
  → stage to .txn/{txId}/
  → atomic lifecycle write
  → return reviewed lifecycle
```

### 11.3 Approval Chain

```
POST /audits/:id/approve
→ server.js
→ approveAudit(store, slug, runId, approver)
→ store._readLifecycle(slug, runId)
→ validateTransition(draft|reviewed → approved)
→ isReviewComplete(lc.review)
→ store.readCommittedArtifacts(slug, runId)
→ verify txId match
→ normalizeCompetitorApprovalState() → structural comparison
→ competitor approval gate (4 checks)
→ internal-link checklist gate
→ buildApprovalRecord()
→ renderApprovedReport(model)
→ store.writeApprovedPages(slug, runId, approvalRecord, pages)
→ return {lifecycle, pageCount}
```

---

## 12. Dependency Health Summary

| Concern | Status | Detail |
|---|---|---|
| Circular dependencies | NONE | DAG confirmed |
| Provider leakage into scoring | LOW | Private fields (`_contentEvidenceAvailable`) from one adapter |
| Provider leakage into rendering | HIGH | All section renderers read raw `model.evidence.*` |
| Adapters controlling lifecycle | LOW | No direct state mutation; classification autonomy concerns |
| Adapters performing permanent writes | HIGH | 5 parallel write paths outside central store |
| Raw payload consumers | HIGH | 14 section renderers read raw evidence directly |
| n8n duplicate logic | MEDIUM | Compaction in 2 places; hardcoded `/tmp` paths |
| Database absence | HIGH | No database layer exists; charter requires one |
| Local-disk default | CRITICAL | Container restart loses all state in default config |
| S3 as optional | MEDIUM | Conditional on env var; 5 adapter writes ignore S3 |
