# Vantage End-to-End Worker

## Locked acceptance standard

`services/worker/src/report/karen-leslie-template.html` is the immutable visual source of truth. Its CSS and JavaScript hashes are pinned by `verify-template.js`.

The report renderer preserves the canonical CSS, header shape, sticky navigation, 13 section order and IDs, card and table classes, footer, responsive rules, and JavaScript navigation behavior. The renderer changes only report-specific content and values. `npm run check:template` blocks changes to the locked CSS or JavaScript.

## Runtime flow

1. `POST /audits`
2. Capture target website evidence with the bounded crawler
3. Render JavaScript pages with Playwright when static HTML is insufficient
4. Capture up to three supplied competitors
5. Run PageSpeed Insights first for mobile and desktop (one retry for transient failures)
6. Fall back to local Lighthouse CLI when PageSpeed returns 429, timeout, repeated 5xx, invalid response, or no usable Lighthouse result
7. Query CrUX separately when configured (field data only when valid CrUX evidence exists)
8. Collect performance for homepage + primary conversion page (when discoverable from crawl)
9. Every normalized performance result includes provider, device, run time, URL, lab/field classification, strategy/config, and raw artifact reference
10. PageSpeed lab results and Lighthouse CLI results are labelled lab data — never field data
11. When Lighthouse succeeds after PageSpeed fails, preserve PageSpeed failure status, Lighthouse result, fallback usage, and provider provenance
12. When both providers fail: performance module marked Not Assessed, excluded from assessed scoring weight, no zero score, no false performance finding
13. Collect DataForSEO backlink evidence when configured
14. Collect optional GA4 context when configured
15. Calculate deterministic Vantage scores
16. Render the locked Karen Leslie report with provider provenance, device, tested URL, collection time, lab/field classification, and fallback status
17. Write `index.html`, `audit.json`, `evidence.json`, and `manifest.json`
18. Store locally or in S3
19. Return the report URL or artifact path

## Required request

```json
{
  "targetUrl": "https://example.com",
  "businessName": "Example Business",
  "location": "London, Ontario, Canada",
  "language": "en-CA",
  "primaryGoal": "Generate qualified enquiries",
  "competitors": ["https://competitor-one.example", "https://competitor-two.example"]
}
```

Only `targetUrl` is required.

## Local commands

```bash
cd services/worker
npm install
npm test
npm run check:template
npm run audit -- --url https://example.com --business "Example Business"
npm start
```

## Task 7 — PageSpeed-to-Lighthouse Fallback

### Behaviour

- **PageSpeed-first**: Google PageSpeed Insights always runs first.
- **One retry**: Transient failures (HTTP 5xx, timeout, network) are retried once. Rate-limit (429) and auth errors (401/403) are NOT retried.
- **Lighthouse fallback**: Lighthouse CLI runs automatically when PageSpeed remains unavailable due to 429/quota, timeout, repeated 5xx, invalid response, or no usable Lighthouse result.
- **Provenance**: Every normalized result includes `provider`, `device`, `runTime`, `url`, `dataType` (lab/field), `isLabData`, `isFieldData`, `fallbackUsed`, `psiFailure` (when applicable), and `rawArtifactRef`.
- **Lab vs field**: PageSpeed lab scores and Lighthouse CLI results are labelled lab data — never described as field data. CrUX data only when valid.
- **Dual failure**: When both providers fail, the performance module is Not Assessed, excluded from scoring weight, and generates no zero score or false finding.
- **Multi-URL**: Performance is collected for homepage + primary conversion page (when discoverable from crawl). Backward-compatible with single-URL collection.
- **Source status**: Uses the canonical seven-status vocabulary. When fallback is used, PageSpeed failure is preserved alongside the Lighthouse result.

### Required environment variables

| Variable | Purpose |
|---|---|
| `GOOGLE_PAGESPEED_API_KEY` | PageSpeed Insights API key |
| `GOOGLE_CRUX_API_KEY` | CrUX API key (falls back to PageSpeed key) |

### Lighthouse in production

The Railway Docker container includes `lighthouse`, `chrome-launcher`, and `playwright` as optional dependencies. Chromium is installed via `npx playwright install --with-deps chromium` in the Dockerfile.

### Test command

```bash
npm test
```

### Ten-run acceptance command

```bash
npm run acceptance:task7
```

Or with a custom test URL:

```bash
node scripts/acceptance-task7.js https://your-test-site.com
```

The acceptance harness runs 10 consecutive performance collections and records run number, tested URLs, device profiles, PageSpeed result, retry count, Lighthouse fallback usage, final provider, source status, module eligibility, artifact reference, and elapsed time.

**Acceptance condition**: 10 consecutive runs, ≥90% successful modules, no false score when both providers fail, consistent provider provenance.

**Live acceptance result (2026-07-26)**: 10/10 PASS — all runs completed with PageSpeed Insights as primary provider; 100% completion; 0 fallback events; 0 false scores; provenance validated.

## API

- `GET /health`
- `POST /audits`

When `VANTAGE_WEBHOOK_SECRET` is configured, send the same value in `x-vantage-secret`.

## PageSpeed resilience

The performance collector uses PageSpeed Insights, local Lighthouse fallback through Playwright Chromium, a separate CrUX lookup when configured, and cached results for 24 hours. A PageSpeed quota or service failure does not stop the report.

## Optional sources

DataForSEO and GA4 do not block the core audit when credentials are absent. Their absence is recorded in the evidence manifest and does not reduce the conversion-readiness score.

## Backlink transition

The original Phase 1 backlink suite included an isolation assertion requiring production scoring and audit directories not to exist. That assertion became invalid when the end-to-end worker was built. The historical suite is preserved as `backlink-adapter.legacy.js`; CI now tests the integrated production provider in `src/evidence/backlinks-provider.test.js`, including optional operation, live `target` payloads, and competitor opportunity classification.

## n8n

Import `services/n8n/vantage-audit-orchestration.json`. Configure `VANTAGE_WORKER_URL` and `VANTAGE_WEBHOOK_SECRET`. n8n orchestrates only; all evidence, scoring, report generation, and storage remain in the worker.

## Secrets required later

- `GOOGLE_PAGESPEED_API_KEY`
- `GOOGLE_CRUX_API_KEY`
- `DATAFORSEO_LOGIN`
- `DATAFORSEO_PASSWORD`
- `AWS_REGION`
- `VANTAGE_REPORTS_BUCKET`
- Optional: `GA4_PROPERTY_ID`
- Optional: `GOOGLE_SERVICE_ACCOUNT_JSON`

The runtime role requires only `s3:PutObject` and `s3:GetObject`, scoped to the configured report prefix.
