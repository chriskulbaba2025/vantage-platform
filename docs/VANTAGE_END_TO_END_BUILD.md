# Vantage End-to-End Worker

## Locked acceptance standard

`services/worker/src/report/karen-leslie-template.html` is the immutable visual source of truth. Its CSS and JavaScript hashes are pinned by `verify-template.js`.

The report renderer preserves the canonical CSS, header shape, sticky navigation, 13 section order and IDs, card and table classes, footer, responsive rules, and JavaScript navigation behavior. The renderer changes only report-specific content and values. `npm run check:template` blocks changes to the locked CSS or JavaScript.

## Runtime flow

1. `POST /audits`
2. Capture target website evidence with the bounded crawler
3. Render JavaScript pages with Playwright when static HTML is insufficient
4. Capture up to three supplied competitors
5. Run PageSpeed Insights for mobile and desktop
6. Fall back to local Lighthouse when PSI fails or reaches quota
7. Query CrUX separately when configured
8. Collect DataForSEO backlink evidence when configured
9. Collect optional GA4 context when configured
10. Calculate deterministic Vantage scores
11. Render the locked Karen Leslie report
12. Write `index.html`, `audit.json`, `evidence.json`, and `manifest.json`
13. Store locally or in S3
14. Return the report URL or artifact path

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
