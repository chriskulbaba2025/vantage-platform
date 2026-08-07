# Prysm WP6 Checklist — Adapter Migration

**Version:** 1.0.1
**Branch:** feat/prysm-wp6-adapter-migration
**PR:** TBD
**Required starting SHA:** c3edc3d0781ecdf54214d2932e7f5a03fad972f5
**Objective:** All 6 production evidence adapters execute behind the universal `execute()` contract, every source result validates against the source-result schema, and raw evidence bytes are preserved for artifact storage.
**Baseline active cycle time:** TBD (first governed WP6–WP12 cycle)
**55% target active cycle time:** TBD

## Permitted files

- [x] `services/worker/src/adapters/dataforseo-onpage/`
- [x] `services/worker/src/adapters/dataforseo-serp/`
- [x] `services/worker/src/adapters/dataforseo-backlinks/`
- [x] `services/worker/src/evidence/pagespeed-client.js`
- [x] `services/worker/src/evidence/ga4-client.js`
- [x] `services/worker/src/evidence/gsc-client.js`
- [x] `services/worker/src/evidence/backlinks-provider.js`
- [x] `services/worker/src/orchestration/retry-policy.js`
- [x] `services/worker/test-fixtures/orchestration/mock-adapters.js`
- [x] `services/worker/src/adapters/wp6-adapter-contract.test.js` (v1.0.1 correction)
- [x] `services/worker/scripts/acceptance-wp6.js` (new WP6 verification script)
- [x] `services/worker/package.json` (WP6 npm script only)
- [x] `docs/prysm-governance/work-packages/WP6_CHECKLIST.md`

## Prohibited files

- [x] `services/worker/src/report/**`
- [x] `services/worker/src/scoring/**`
- [x] `services/worker/src/contracts/**` (schemas read-only)
- [x] `services/worker/src/n8n/**`
- [x] `services/worker/src/audit/**`
- [x] `services/worker/src/lifecycle/**`
- [x] `services/worker/src/storage/**`
- [x] `services/worker/src/orchestration/audit-orchestrator.js`
- [x] `services/worker/src/orchestration/artifact-recovery.js`
- [x] `services/worker/scripts/**` (except `acceptance-wp6.js`)
- [x] `report-golden-master/**`
- [x] `docs/**` (except WP6_CHECKLIST.md)

---

## Requirements

### WP6-ADP-01 — DataForSEO On-Page adapter implements execute() contract

- [ ] Behaviour: `crawlWithDataforseo` is wrapped behind `execute({ auditRequest, source, executionId, sourceExecutionKey, signal, attempt })` returning `{ rawBytes, contentType, sourceResult }`.
- [ ] Implementation boundary: `services/worker/src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.js`
- [ ] Unit proof: `assert.equal(typeof adapter.execute, "function")`; call returns `{ rawBytes, contentType, sourceResult }` with `sourceResult.source === "dataforseo-onpage"`.
- [ ] Acceptance proof: `sourceResult` validates against `source-result.schema.json`; `adapterVersion` matches semver pattern.
- [ ] Failure state: Missing credentials → `sourceResult.status === "FAILED"` with `errorCategory === "auth"`.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Provider field = `DataForSEO`, adapter registered with `adapterVersion`.

### WP6-ADP-02 — DataForSEO On-Page returns all canonical statuses

- [ ] Behaviour: Fixture-driven tests prove `AVAILABLE`, `PARTIAL`, `BLOCKED`, `FAILED`, `UNAVAILABLE` statuses with correct `coverage`, `limitations`, and `errorCategory`.
- [ ] Implementation boundary: `dataforseo-onpage-adapter.js` execute() + fixture client.
- [ ] Unit proof: Each status fixture produces `sourceResult.status === EXPECTED_STATUS`; `PARTIAL` includes `limitations.length > 0`; `BLOCKED` includes robot/login limitation text.
- [ ] Acceptance proof: Orchestrator integration test with each status fixture — each reaches correct `sourceCounts` counter.
- [ ] Failure state: `FAILED` preserves `requestId` (task ID) when obtained before failure.
- [ ] Prohibited later events/calls/writes: `BLOCKED` status must not trigger adapter retries.
- [ ] Final-report evidence: On-Page crawl ceiling → `PARTIAL`; robots restriction → `BLOCKED`; login restriction → `BLOCKED`.

### WP6-ADP-03 — DataForSEO On-Page preserves raw artifact bytes

- [ ] Behaviour: `execute()` returns `rawBytes` (Buffer) containing the complete raw provider payload; `contentType` = `"application/json"`.
- [ ] Implementation boundary: `dataforseo-onpage-adapter.js` execute().
- [ ] Unit proof: `rawBytes instanceof Buffer`; `rawBytes.length > 0`; `JSON.parse(rawBytes.toString())` succeeds; SHA-256 of `rawBytes` matches.
- [ ] Acceptance proof: Orchestrator persists raw bytes via artifact store; read-back bytes equal original bytes; independent SHA-256 matches.
- [ ] Failure state: If no raw bytes (e.g., task post failure), `rawBytes === null` — not zero-length Buffer.
- [ ] Prohibited later events/calls/writes: Adapter does not perform permanent artifact writes — orchestrator owns persistence.
- [ ] Final-report evidence: Raw artifact reference exists in source result.

### WP6-ADP-04 — PageSpeed adapter implements execute() contract

- [ ] Behaviour: `collectPerformance` is wrapped behind `execute({ auditRequest, source, executionId, sourceExecutionKey, signal, attempt })`.
- [ ] Implementation boundary: `services/worker/src/evidence/pagespeed-client.js`
- [ ] Unit proof: `adapter.execute(...)` returns `{ rawBytes, contentType, sourceResult }`; `sourceResult.source === "pagespeed"`; `sourceResult.provider` reflects actual provider used.
- [ ] Acceptance proof: `sourceResult` validates against `source-result.schema.json`.
- [ ] Failure state: Both PageSpeed and Lighthouse fail → `sourceResult.status === "FAILED"`, never zero.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Provider provenance recorded (pagespeed-insights vs lighthouse-cli-fallback).

### WP6-ADP-05 — PageSpeed executes before Lighthouse with correct fallback

- [ ] Behaviour: PageSpeed API called first; on eligible failure (rate-limit, 5xx, timeout), Lighthouse CLI runs; successful Lighthouse fallback records `fallbackUsed: true` in evidence.
- [ ] Implementation boundary: `pagespeed-client.js` execute().
- [ ] Unit proof: Fixture that fails PageSpeed then succeeds Lighthouse → `sourceResult.status` is `AVAILABLE` or `PARTIAL` (not `FAILED`); evidence shows `fallbackUsed: true`.
- [ ] Acceptance proof: Both providers fail → status `FAILED`, performance Not Assessed downstream (not zero score).
- [ ] Failure state: `FAILED` when both providers cannot produce usable scores; `errorCategory` set correctly.
- [ ] Prohibited later events/calls/writes: Lighthouse fallback must not be called when PageSpeed succeeds.
- [ ] Final-report evidence: Performance provenance visible; fallback noted.

### WP6-ADP-06 — PageSpeed preserves raw artifact bytes

- [ ] Behaviour: `execute()` returns `rawBytes` containing the PageSpeed API response (or Lighthouse result when fallback used).
- [ ] Implementation boundary: `pagespeed-client.js` execute().
- [ ] Unit proof: `rawBytes` is Buffer with >0 length on success; SHA-256 verifiable.
- [ ] Acceptance proof: Orchestrator persists and read-back verifies.
- [ ] Failure state: `rawBytes === null` when no provider response obtained.
- [ ] Prohibited later events/calls/writes: Adapter does not own permanent writes.

### WP6-ADP-07 — DataForSEO SERP adapter implements execute() contract

- [ ] Behaviour: SERP competitor discovery wrapped behind `execute()` returning `{ rawBytes, contentType, sourceResult }`.
- [ ] Implementation boundary: `services/worker/src/adapters/dataforseo-serp/` — new adapter wrapper file.
- [ ] Unit proof: `sourceResult.source === "dataforseo-serp"`; `sourceResult.provider === "DataForSEO"`; validates against source-result schema.
- [ ] Acceptance proof: All status fixtures (AVAILABLE, PARTIAL, FAILED, NOT_APPLICABLE) produce correct results.
- [ ] Failure state: No competitors supplied → `NOT_APPLICABLE`; API failure → `FAILED` with preserved error category.
- [ ] Prohibited later events/calls/writes: Adapter does not own competitor qualification — returns raw SERP results only.
- [ ] Final-report evidence: SERP source status visible in source-status summary.

### WP6-ADP-08 — DataForSEO SERP preserves raw artifact bytes

- [ ] Behaviour: `execute()` returns raw SERP API response bytes.
- [ ] Implementation boundary: SERP adapter wrapper.
- [ ] Unit proof: Buffer with valid JSON on success.
- [ ] Acceptance proof: Orchestrator persistence and verification.
- [ ] Failure state: `rawBytes === null` when API call fails.
- [ ] Prohibited later events/calls/writes: Adapter does not own permanent writes.

### WP6-ADP-09 — Backlinks adapter implements execute() contract

- [ ] Behaviour: Backlinks provider wrapped behind `execute()` returning `{ rawBytes, contentType, sourceResult }`.
- [ ] Implementation boundary: `services/worker/src/evidence/backlinks-provider.js` + `services/worker/src/adapters/dataforseo-backlinks/`.
- [ ] Unit proof: `sourceResult.source` includes "backlinks"; validates against source-result schema.
- [ ] Acceptance proof: Status fixtures produce correct source statuses.
- [ ] Failure state: API failure → `FAILED`; no backlinks found → `UNAVAILABLE`.
- [ ] Prohibited later events/calls/writes: Adapter does not own permanent writes.
- [ ] Final-report evidence: Backlinks source status in summary.

### WP6-ADP-10 — Backlinks preserves raw artifact bytes

- [ ] Behaviour: `execute()` returns raw backlinks API response bytes.
- [ ] Implementation boundary: Backlinks adapter wrapper.
- [ ] Unit proof: Buffer with valid JSON on success.
- [ ] Acceptance proof: Orchestrator persistence and verification.
- [ ] Failure state: `rawBytes === null` on failure.
- [ ] Prohibited later events/calls/writes: Adapter does not own permanent writes.

### WP6-ADP-11 — GA4 adapter implements execute() contract

- [ ] Behaviour: GA4 client wrapped behind `execute()`; returns `NOT_CONNECTED` when no property configured.
- [ ] Implementation boundary: `services/worker/src/evidence/ga4-client.js`.
- [ ] Unit proof: `sourceResult.status === "NOT_CONNECTED"` when `auditRequest.ga4` is absent; `sourceResult.source` references ga4.
- [ ] Acceptance proof: NOT_CONNECTED status with correct `errorCategory: "not_configured"`.
- [ ] Failure state: API failure → `FAILED`; never silently omits GA4.
- [ ] Prohibited later events/calls/writes: GA4 stores aggregate evidence only — no user-level records.
- [ ] Final-report evidence: GA4 absent → `NOT_CONNECTED` visible.

### WP6-ADP-12 — GA4 preserves raw artifact bytes (aggregate only)

- [ ] Behaviour: `execute()` returns raw GA4 API response bytes (aggregated data only).
- [ ] Implementation boundary: `ga4-client.js` execute().
- [ ] Unit proof: Buffer with valid JSON on success; no user-level records in payload.
- [ ] Acceptance proof: Orchestrator persistence.
- [ ] Failure state: `rawBytes === null` when not connected.
- [ ] Prohibited later events/calls/writes: No user-level GA4 records stored.

### WP6-ADP-13 — GSC adapter implements execute() contract

- [ ] Behaviour: GSC client wrapped behind `execute()`; returns `NOT_CONNECTED` when no site configured.
- [ ] Implementation boundary: `services/worker/src/evidence/gsc-client.js`.
- [ ] Unit proof: `sourceResult.status === "NOT_CONNECTED"` when `auditRequest.gsc` is absent; low-volume evidence follows sufficiency threshold.
- [ ] Acceptance proof: NOT_CONNECTED status correct; low-volume data → `PARTIAL` with limitation.
- [ ] Failure state: API failure → `FAILED`.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: GSC absent → `NOT_CONNECTED` visible.

### WP6-ADP-14 — GSC preserves raw artifact bytes

- [ ] Behaviour: `execute()` returns raw GSC API response bytes.
- [ ] Implementation boundary: `gsc-client.js` execute().
- [ ] Unit proof: Buffer with valid JSON on success.
- [ ] Acceptance proof: Orchestrator persistence.
- [ ] Failure state: `rawBytes === null` when not connected or failed.
- [ ] Prohibited later events/calls/writes: None.

### WP6-ADP-15 — All adapters validate against universal source-result schema

- [ ] Behaviour: Every adapter's `sourceResult` must pass validation against `source-result.schema.json` for every status (AVAILABLE, PARTIAL, FAILED, BLOCKED, UNAVAILABLE, NOT_CONNECTED, NOT_APPLICABLE).
- [ ] Implementation boundary: All 6 adapter wrappers.
- [ ] Unit proof: Run schema validator on each adapter's sourceResult for each status fixture; all pass.
- [ ] Acceptance proof: `npm run test:schemas` passes; contract validation integration test passes.
- [ ] Failure state: Any sourceResult failing schema validation → orchestrator throws `Source result validation failed`.
- [ ] Prohibited later events/calls/writes: Invalid source results must not reach canonical evidence assembly.
- [ ] Final-report evidence: All source results schema-valid.

### WP6-ADP-16 — No provider-specific fields leak past canonical normalization

- [ ] Behaviour: Provider-specific response shape (DataForSEO task post result, raw PageSpeed JSON, raw GA4 rows) must not appear in `sourceResult.evidence` or downstream scoring/report inputs.
- [ ] Implementation boundary: All 6 adapter wrappers.
- [ ] Unit proof: `sourceResult.evidence` contains no `_dataforseo`, `_raw`, `rawSummary`, `rawPages`, `lhr`, `rows`, or other provider-internal fields.
- [ ] Acceptance proof: Canonical evidence assembly receives only normalized fields.
- [ ] Failure state: Provider-internal field detected in evidence → test fail.
- [ ] Prohibited later events/calls/writes: Provider payload must not reach scoring or report modules.
- [ ] Final-report evidence: Report logic independent of provider-specific formats.

### WP6-ADP-17 — One adapter failure does not corrupt unrelated source results

- [ ] Behaviour: When one adapter's `execute()` throws, other adapters continue independently and produce valid results.
- [ ] Implementation boundary: Orchestrator integration test.
- [ ] Unit proof: Run orchestrator with one failing adapter; other adapters complete with correct statuses.
- [ ] Acceptance proof: `sourceCounts` show one FAILED, other sources normal; canonical evidence assembles for successful sources only.
- [ ] Failure state: Failing adapter's source result is FAILED; other adapters unaffected.
- [ ] Prohibited later events/calls/writes: One adapter failure must not prevent other source results from being persisted.
- [ ] Final-report evidence: Source-status summary shows independent source states.

### WP6-ADP-18 — Adapters do not perform prohibited permanent writes

- [ ] Behaviour: No adapter directly calls `artifactStore.put()`, `writeFile()`, or any permanent storage API. Raw bytes are returned to the orchestrator.
- [ ] Implementation boundary: All 6 adapter wrappers.
- [ ] Unit proof: Mock artifact store call count = 0 during adapter execution; grep for `writeFile`, `artifactStore`, `put(` in adapter code paths yields no direct storage calls.
- [ ] Acceptance proof: Integration test with real artifact store shows writes originate only from orchestrator.
- [ ] Failure state: Adapter-owned write detected → test fail.
- [ ] Prohibited later events/calls/writes: `artifactStore.put()`, `fs.writeFile()`, `fs.writeFileSync()`, any permanent storage call.
- [ ] Final-report evidence: Artifact writes attributed to orchestrator, not adapters.

### WP6-ADP-19 — Registered adapterVersion matches returned adapterVersion

- [ ] Behaviour: `adapter.adapterVersion` (registered) must match `sourceResult.adapterVersion` (returned). Mismatch causes orchestrator rejection.
- [ ] Implementation boundary: All 6 adapters + orchestrator version check (existing WP5-CLOSE-ADP-03).
- [ ] Unit proof: Adapter with mismatched version → orchestrator throws `Adapter version mismatch`.
- [ ] Acceptance proof: All production adapters pass version match check.
- [ ] Failure state: Version mismatch → `throw new Error(...)`.
- [ ] Prohibited later events/calls/writes: Mismatched source result must not be persisted.
- [ ] Final-report evidence: All adapter versions consistent.

### WP6-ADP-20 — Mock adapters updated to match production adapter signatures

- [ ] Behaviour: `test-fixtures/orchestration/mock-adapters.js` mock adapters produce source results that validate against the source-result schema and include all required fields.
- [ ] Implementation boundary: `mock-adapters.js`.
- [ ] Unit proof: Mock adapter sourceResult validates against source-result schema; includes `contractVersion`, `schemaVersion`, `source`, `provider`, `adapterVersion`, `status`, `startedAt`, `completedAt`, `retryCount`, `coverage`, `limitations`.
- [ ] Acceptance proof: All existing orchestrator tests pass with updated mock adapters.
- [ ] Failure state: Missing required field → schema validation fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Mock adapters produce schema-valid source results.

---

## Verification commands

- [ ] `npm run test:schemas` — all schemas compile, fixtures pass
- [ ] `npm test` — full unit test suite (no live provider/LLM calls)
- [ ] `node --test src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.test.js` — On-Page adapter tests
- [ ] `node --test src/adapters/dataforseo-serp/serp-production-path.test.js` — SERP adapter tests
- [ ] `node --test src/evidence/pagespeed-client.test.js` — PageSpeed tests
- [ ] `node --test src/evidence/backlinks-provider.test.js` — Backlinks tests
- [ ] `node --test src/evidence/gsc-client.test.js` — GSC tests
- [ ] `node --test test-fixtures/orchestration/orchestrator.test.js` — orchestrator integration
- [ ] `npm run test:artifacts` — artifact storage tests
- [ ] `npm run test:lifecycle` — lifecycle tests
- [ ] `npm run acceptance:wp2` — WP2 schema acceptance
- [ ] `npm run acceptance:wp3` — WP3 artifact acceptance
- [ ] `npm run acceptance:wp4` — WP4 state machine acceptance
- [ ] `npm run acceptance:wp5` — WP5 orchestrator acceptance
- [ ] `npm run check:template` — template integrity

---

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
