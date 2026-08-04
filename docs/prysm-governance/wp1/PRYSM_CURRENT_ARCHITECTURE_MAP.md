# Prysm Current Architecture Map

**Document:** WP1-02  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Purpose:** Show the current production flow from intake through providers, persistence, scoring, n8n, rendering, approval and client delivery.

---

## 1. Production Flow Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT / WEB APP                              │
│  POST /audits  │  GET /audits/:id  │  POST /audits/:id/review          │
│                │  POST /audits/:id/approve  │  GET /reports/:slug/:id  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTP (x-vantage-secret)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    server.js (Port 3000, Raw node:http)                 │
│                                                                         │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────────────────┐  │
│  │ POST /audits │  │ /audits/:id   │  │ OAuth /connect /callback    │  │
│  │ → runAudit() │  │ /review       │  │ /connection /disconnect     │  │
│  │              │  │ /approve      │  │ (GA4 + GSC)                 │  │
│  └──────┬───────┘  └───────┬───────┘  └─────────────────────────────┘  │
│         │                  │                                            │
└─────────┼──────────────────┼────────────────────────────────────────────┘
          │                  │
          ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    audit/run-audit.js (Orchestrator)                    │
│                                                                         │
│  runAudit(input, options)           submitReview(store, ...)            │
│  approveAudit(store, ...)           getAuditStatus(store, ...)          │
│                                                                         │
│  Pipeline:                                                              │
│  1. validateInput → 2. crawl → 3. parallel evidence → 4. score         │
│  5. finalization gate → 6. render → 7. store → 8. return manifest      │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       │ Evidence Collection (6 providers executed in parallel)
       │
       ├──► adapters/dataforseo-onpage/dataforseo-onpage-adapter.js
       │    │  → DataForSEO On-Page API (taskPost → poll → pages/summary)
       │    │  → Normalizes to canonical site envelope
       │    │  → Writes raw artifact directly to disk (VIOLATION)
       │    │  → Returns: AVAILABLE | PARTIAL | BLOCKED | FAILED
       │    │
       │    ├──► evidence/site-crawler.js (legacy fallback)
       │    │  → Playwright browser + cheerio parsing
       │    │  → Only returns AVAILABLE (no PARTIAL/BLOCKED)
       │    │
       │    └──► evidence/page-extractor.js (HTML parser utility)
       │
       ├──► evidence/pagespeed-client.js
       │    │  → Google PageSpeed Insights v5 API
       │    │  → Google Chrome UX Report (CrUX) API
       │    │  → Lighthouse CLI fallback (chrome-launcher + Playwright)
       │    │  → Writes cache files + screenshots directly to disk (VIOLATION)
       │    │  → Returns: AVAILABLE | PARTIAL | FAILED
       │    │
       │    └──► evidence/screenshot-artifact.js
       │       → JPEG + metadata JSON writes to local FS
       │
       ├──► evidence/backlinks-provider.js
       │    │  → DataForSEO v3 Backlinks API
       │    │  → Normalize + classify (good/bad/worth_pursuing/ignore)
       │    │  → Competitor domain overlap analysis
       │    │  → Returns: AVAILABLE | NOT_CONNECTED (no PARTIAL/FAILED)
       │    │
       │    └──► adapters/dataforseo-backlinks/ (classifier, normalizer, writer)
       │
       ├──► evidence/ga4-client.js
       │    │  → GA4 Data API v1beta (runReport)
       │    │  → OAuth or service account auth
       │    │  → Returns: AVAILABLE | FAILED | NOT_CONNECTED
       │    │
       │    └──► auth/oauth-service.js + auth/token-store.js
       │       → AES-256-GCM encrypted token storage
       │
       ├──► evidence/gsc-client.js
       │    │  → GSC API v1 (searchAnalytics.query)
       │    │  → Two 28-day windows, sufficiency gate (≥100 impressions)
       │    │  → Returns: AVAILABLE | UNAVAILABLE | NOT_CONNECTED
       │    │
       │    └──► auth/oauth-service.js (shared with GA4)
       │
       └──► evidence/competitor-opportunity-layer.js
            │  → DataForSEO SERP API (per-topic queries)
            │  → 5-check candidate qualification gate
            │  → 6-check gap qualification rule
            │  → Returns: AVAILABLE | PARTIAL | FAILED | NOT_CONNECTED
            │
            └──► adapters/dataforseo-serp/ (client, locale, location)

       Sequential (runs after parallel):
       ├──► evidence/internal-link-opportunity.js
       │  → Pure computation from crawl data (O(n²) pairwise)
       │  → Not an external evidence provider
       └──► competitor-opportunity-layer (after crawl + competitors)

┌─────────────────────────────────────────────────────────────────────────┐
│                          SCORING LAYER                                   │
│                                                                         │
│  scoring/vantage-score.js (scoreAudit)                                  │
│  ├── score-components.js (DIMENSIONS, MODULES, 12 finding rules)        │
│  ├── evidence-contracts.js (SOURCE_STATUS, buildSourceStatus)           │
│  ├── report-model.js (conversion paths, topics, content ideas)          │
│  ├── diagnostic-contracts.js (22 diagnostic codes)                      │
│  ├── rendering-diagnostics.js (19 classification rules)                 │
│  └── report-finalization-gate.js (6-step validation gate)               │
│                                                                         │
│  5 Dimensions: Trust/EEAT, Content Funnel, Conversion Pathways,         │
│                Technical Performance, Entity/Schema/AI                  │
│  13 Modules: weighted, source-gated, scored 0-100                       │
│  12 Finding rules: evidence-enforced, deterministic IDs, priority calc  │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          RENDERING LAYER                                 │
│                                                                         │
│  render-report.js (single-page draft)                                   │
│  ├── sections-conversion.js (scorecard, fixes, paths, map, ideas, comp) │
│  ├── sections-trust.js (EEAT, CMS/platform)                             │
│  ├── sections-seo.js (technical, headings, schema)                      │
│  ├── sections-performance.js (performance, appendix)                    │
│  ├── sections-internal-links.js (internal link opportunities)           │
│  ├── html-helpers.js (table, scoreCard, section builders)               │
│  └── karen-leslie-template.html (CSS/JS hash-locked)                    │
│                                                                         │
│  render-approved-report.js (15-page multi-page approved)                │
│  └── Same section renderers + 15-page map + standalone HTML pages       │
│                                                                         │
│  ⚠ ALL section renderers read model.evidence.* directly                 │
│  ⚠ No ReportViewModel abstraction exists                                │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          STORAGE LAYER                                   │
│                                                                         │
│  storage/report-store.js (createReportStore factory)                    │
│  ├── Local: {artifactDir}/{slug}/{runId}/ (lifecycle.json + artifacts)  │
│  └── S3: {prefix}/{slug}/{runId}/ (conditional on VANTAGE_REPORTS_BUCKET)│
│                                                                         │
│  storage/artifact-store.js (legacy, parallel store)                     │
│  └── Local: writeJsonArtifact/readJsonArtifact/artifactExists           │
│                                                                         │
│  storage/s3-artifact-store.js (legacy S3, separate from report store)   │
│                                                                         │
│  ⚠ Three separate storage paths exist (report-store, artifact-store,    │
│    direct fs writes from adapters)                                       │
│  ⚠ Local filesystem is the DEFAULT, not a development convenience       │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          n8n BOUNDARY                                    │
│                                                                         │
│  n8n/prepare-payload.js (compaction script)                             │
│  n8n/build-report.js (HTML assembly, hardcoded /tmp paths)              │
│  n8n/generate-zip.js (zip packaging, Unix+PowerShell fallback)          │
│                                                                         │
│  services/n8n/vantage-audit-orchestration.json (4-node workflow)        │
│  ├── Webhook → Validate → HTTP to worker → Return result                │
│                                                                         │
│  n8n/prysm-n8n-workflow.json (10-node GPT workflow)                     │
│  ├── Webhook → Validate → Compact → 3× GPT-5.5 → Merge → Validate      │
│  ├── → Assemble HTML → Generate ZIP → Respond                           │
│  ⚠ Duplicate compaction logic (prepare-payload.js AND workflow inlined) │
│  ⚠ 3 live GPT-5.5 calls per report generation                           │
└─────────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          LIFECYCLE / APPROVAL                            │
│                                                                         │
│  audit/review-gate.js (state machine)                                   │
│  ├── LIFECYCLE_STATUS: draft → reviewed → approved                     │
│  ├── validateTransition, buildReviewRecord, buildApprovalRecord         │
│  ├── validateCompetitorDecisions, buildCompetitorOverrides              │
│  └── isReviewComplete (checklist-based)                                 │
│                                                                         │
│  Delivery gate: GET /reports/* → only APPROVED reports served           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. File Organization

```text
services/worker/
├── src/
│   ├── server.js                    # HTTP API (all routes in one file)
│   ├── config.js                    # Env-var configuration (26 keys)
│   ├── utils.js                     # Shared utilities
│   ├── audit/
│   │   ├── run-audit.js             # Central orchestrator (903 lines)
│   │   └── review-gate.js           # Lifecycle state machine + review logic
│   ├── runners/
│   │   └── run-audit.js             # CLI shim (31 lines)
│   ├── adapters/
│   │   ├── dataforseo-onpage/       # Primary crawl (adapter + client)
│   │   ├── dataforseo-backlinks/    # Backlink client + normalizer + writer
│   │   └── dataforseo-serp/         # SERP client + locale + location
│   ├── evidence/
│   │   ├── pagespeed-client.js      # PSI + Lighthouse fallback
│   │   ├── ga4-client.js            # GA4 Data API
│   │   ├── gsc-client.js            # GSC API
│   │   ├── backlinks-provider.js    # Backlink collection orchestrator
│   │   ├── competitor-opportunity-layer.js  # SERP + qualification
│   │   ├── internal-link-opportunity.js     # Internal link computation
│   │   ├── site-crawler.js          # Legacy crawler (Playwright)
│   │   ├── page-extractor.js        # HTML parsing utility
│   │   └── screenshot-artifact.js   # Screenshot persistence
│   ├── scoring/
│   │   ├── vantage-score.js         # Top-level scoring orchestrator
│   │   ├── score-components.js      # Dimensions, modules, findings
│   │   ├── evidence-contracts.js    # Source-status vocabulary (7 values)
│   │   ├── diagnostic-contracts.js  # Diagnostic codes (22 codes)
│   │   ├── rendering-diagnostics.js # Classification engine (19 rules)
│   │   ├── report-model.js          # Display model builders
│   │   └── report-finalization-gate.js  # Pre-render validation
│   ├── report/
│   │   ├── render-report.js         # Single-page draft renderer
│   │   ├── render-approved-report.js # 15-page approved renderer
│   │   ├── sections-*.js            # Section renderers (5 files)
│   │   ├── html-helpers.js          # HTML generation utilities
│   │   ├── verify-template.js       # CSS/JS hash lock verification
│   │   └── karen-leslie-template.html # Locked report template
│   ├── n8n/
│   │   ├── prepare-payload.js       # GPT payload compaction
│   │   ├── build-report.js          # Static HTML assembly (n8n)
│   │   ├── generate-zip.js          # ZIP packaging (n8n)
│   │   └── prysm-n8n-workflow.json  # 10-node GPT workflow
│   ├── storage/
│   │   ├── report-store.js          # Primary store (local + S3, 912 lines)
│   │   ├── artifact-store.js        # Legacy store (backlinks, 243 lines)
│   │   ├── s3-artifact-store.js     # Legacy S3 store
│   │   └── transaction-helpers.js   # SHA-256, txId, integrity checks
│   └── auth/
│       ├── oauth-service.js         # Google OAuth (GA4 + GSC)
│       └── token-store.js           # AES-256-GCM encrypted storage
├── scripts/
│   ├── acceptance-task7.js          # PageSpeed fallback acceptance
│   ├── acceptance-task9.js          # Competitor opportunity acceptance
│   ├── acceptance-task10.js         # Internal link acceptance
│   ├── run-backlink-adapter.js      # Backlink adapter runner
│   └── run-blocked-acceptance.mjs   # BLOCKED status acceptance (needs SSH)
├── test-fixtures/
│   └── rendering/
│       └── may-crawford-no-lcp-fixture.json
├── package.json
├── Dockerfile
└── .env.example
services/n8n/
└── vantage-audit-orchestration.json # 4-node n8n webhook workflow
```

---

## 3. Data Flow

```text
Audit Request (JSON)
  │
  ▼
validateInput() → normalized URL, business name, GA4/GSC properties
  │
  ▼
createProductionCrawlProvider() → DataForSEO On-Page OR NOT_CONNECTED
  │
  ├──► crawlWithDataforseo(targetUrl, opts)
  │    └──► site evidence envelope (sourceStatus, pages, trust, technical)
  │
  ▼
findPrimaryConversionPage(site) → conversion page URL for perf testing
  │
  ▼
Promise.all([
  collectPerformanceForPages([homepage, conversionPage])
    → performance envelope (mobile + desktop + CrUX)
  crawlCompetitors(competitorUrls)
    → competitor crawl results
  collectBacklinks(targetUrl, competitors)
    → backlink envelope (normalized, classified)
  collectGa4({propertyId})
    → GA4 traffic + event data
  collectGsc(siteUrl)
    → GSC search performance (two windows)
])
  │
  ├──► generateInternalLinkOpportunities(site) → internal link recs
  ├──► collectCompetitorOpportunities(site, input) → qualified gaps
  │
  ▼
validateAndDowngrade() × 5 → normalized evidence (FAILED on schema violation)
  │
  ▼
scoreAudit(input, evidence)
  ├── crawl gate → buildNotAssessedModel() if crawl unavailable
  ├── scoreModules() → 13 modules × 5 dimensions
  ├── computeFunnelScores() → awareness, consideration, decision, AI
  ├── buildFindings() → 12 rule-based findings + diagnostic findings
  └── calculateEvidenceConfidence() → 8 weighted factors
  │
  ▼
runFinalizationGate(model, evidence) → contradictions, consistency, categories
  │
  ▼
renderReport(gatedModel) → single-page HTML (draft)
OR renderApprovedReport(model) → 15-page HTML (approved)
  │
  ▼
store.writeReport({slug, runId, html, model, manifest})
  → audit.json, evidence.json, manifest.json, index.html
  → lifecycle.json (status: draft)
  │
  ├──► submitReview() → store.commitCompetitorReview() → lifecycle: reviewed
  ├──► approveAudit() → store.writeApprovedPages() → lifecycle: approved
  │
  ▼
GET /reports/:slug/:runId/index.html (only when APPROVED)
```

---

## 4. Service Boundaries

| Layer | Owner | Current State |
|---|---|---|
| Web app / API | server.js + n8n webhook | Single process with worker logic |
| Audit orchestration | audit/run-audit.js | Centralized, DI-supported for tests |
| Evidence collection | evidence/*.js + adapters/* | Adapters write files directly; no universal contract enforcement |
| Scoring | scoring/*.js | Deterministic, evidence-gated, 5 dimensions |
| Report rendering | report/*.js | Reads raw evidence directly; no view model |
| Artifact storage | storage/report-store.js | Local FS default; S3 conditional; 3 parallel paths |
| n8n / LLM boundary | n8n/*.js | Worker-internal scripts; hardcoded /tmp paths; 3× GPT-5.5 calls |
| Lifecycle / approval | audit/review-gate.js | Checklist-based review gate; atomic transactions |
| Auth / OAuth | auth/*.js | AES-256-GCM encrypted; read-only GA4/GSC scopes |
| Database | NONE | All state in JSON files on FS or S3; no DB integration |

---

## 5. Provider Contract Coverage

| Provider | AVAILABLE | PARTIAL | FAILED | BLOCKED | NOT_CONNECTED | UNAVAILABLE | NOT_APPLICABLE |
|---|---|---|---|---|---|---|---|
| DataForSEO On-Page | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| PageSpeed/Lighthouse | ✓ | ✓ | ✓ | — | — | ✓ (CrUX) | — |
| Backlinks | ✓ | — | — (throws) | — | ✓ | — | — |
| GA4 | ✓ | — | ✓ | — | ✓ | — | — |
| GSC | ✓ | — | — | — | ✓ | ✓ | — |
| Competitor (SERP) | ✓ | ✓ | ✓ | — | ✓ | ✓ | — |
| Internal Links | ✓ | ✓ | — | — | — | — | — |
| Site Crawler (legacy) | ✓ (hardcoded) | — | — (throws) | — | — | — | — |
