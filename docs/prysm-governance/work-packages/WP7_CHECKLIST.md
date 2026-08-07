# Prysm WP7 Checklist — Deterministic Findings and Scores

**Version:** 1.0.0
**Branch:** feat/prysm-wp7-deterministic-findings-scores
**PR:** TBD
**Required starting SHA:** 46653ea4fc5a1df594156997419b473600cfae59
**Objective:** Identical locked canonical evidence and identical rule/scoring versions produce exactly identical module eligibility, findings, priorities, scores, assessed weight, and evidence confidence. Zero LLM scoring operations. Repeatability directly proven.
**Baseline active cycle time:** TBD (first governed WP7 cycle)
**55% target active cycle time:** TBD

## Permitted files

- [ ] `services/worker/src/scoring/vantage-score.js`
- [ ] `services/worker/src/scoring/score-components.js`
- [ ] `services/worker/src/scoring/vantage-score.test.js`
- [ ] `services/worker/src/scoring/evidence-contracts.js`
- [ ] `services/worker/src/contracts/finding.schema.json`
- [ ] `services/worker/src/contracts/score.schema.json`
- [ ] `services/worker/test-fixtures/scoring/deterministic-evidence-fixture.json`
- [ ] `services/worker/scripts/acceptance-wp7.js`
- [ ] `services/worker/package.json`
- [ ] `docs/prysm-governance/work-packages/WP7_CHECKLIST.md`

## Prohibited files

- [ ] `services/worker/src/report/**`
- [ ] `services/worker/src/adapters/**`
- [ ] `services/worker/src/evidence/**`
- [ ] `services/worker/src/n8n/**`
- [ ] `services/worker/src/audit/**`
- [ ] `services/worker/src/lifecycle/**`
- [ ] `services/worker/src/storage/**`
- [ ] `services/worker/src/orchestration/**`
- [ ] `services/worker/src/runners/**`
- [ ] `services/worker/src/server.js`
- [ ] `services/worker/src/config.js`
- [ ] `report-golden-master/**`
- [ ] `docs/**` (except WP7_CHECKLIST.md)

---

## Requirements

### WP7-DET-01 — generatedAt is derived from locked canonical evidence, not live clock

- [ ] Behaviour: `scoreAudit()` receives a `scoredAt` ISO-8601 timestamp from the orchestrator (or derives it as `max(collectedAt)` across all evidence sources). It never calls `new Date()` or `Date.now()` directly.
- [ ] Implementation boundary: `services/worker/src/scoring/vantage-score.js` `scoreAudit()` function.
- [ ] Unit proof: `scoreAudit(input, evidence, { scoredAt: "2026-01-01T00:00:00.000Z" })` produces `generatedAt === "2026-01-01T00:00:00.000Z"`. Without explicit `scoredAt`, `generatedAt` equals `max(collectedAt)` across all evidence sources.
- [ ] Acceptance proof: Two `scoreAudit()` calls on identical evidence 5 seconds apart produce identical `generatedAt`.
- [ ] Failure state: `Date.now()` or `new Date()` present in `vantage-score.js` production path → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: `generatedAt` equals evidence `max(collectedAt)` in locked report.

### WP7-DET-02 — Evidence confidence data freshness uses controlled clock

- [ ] Behaviour: `calculateEvidenceConfidence()` accepts an optional `now` parameter (ISO-8601 or epoch ms). When provided, data freshness is computed against `now`. When omitted, it uses `max(collectedAt)` across evidence sources.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `calculateEvidenceConfidence()`.
- [ ] Unit proof: Same evidence with `now = "2026-01-01T00:00:00Z"` produces identical `dataFreshness` score across calls. Different `now` values produce different freshness scores consistent with age-in-hours formula.
- [ ] Acceptance proof: Deterministic fixture → identical `evidenceConfidenceScore` across two runs.
- [ ] Failure state: `Date.now()` called inside `calculateEvidenceConfidence()` production path → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Evidence confidence score matches scoring version and canonical evidence.

### WP7-DET-03 — All test fixtures use fixed timestamps

- [ ] Behaviour: Every test fixture in `vantage-score.test.js` uses fixed ISO-8601 timestamps (e.g., `"2026-01-15T12:00:00.000Z"`) instead of `new Date().toISOString()`.
- [ ] Implementation boundary: `services/worker/src/scoring/vantage-score.test.js`.
- [ ] Unit proof: Running test suite twice on same commit produces identical assertion values (no time-dependent drift).
- [ ] Acceptance proof: `node --test src/scoring/vantage-score.test.js` passes with fixed fixtures.
- [ ] Failure state: `new Date()` or `Date.now()` in test fixture construction → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: All test fixtures use deterministic timestamps.

### WP7-DET-04 — Canonical evidence fixture is committed

- [ ] Behaviour: A JSON fixture file at `test-fixtures/scoring/deterministic-evidence-fixture.json` contains a complete locked canonical evidence object with fixed timestamps, representing a realistic AVAILABLE crawl + AVAILABLE performance scenario.
- [ ] Implementation boundary: `services/worker/test-fixtures/scoring/deterministic-evidence-fixture.json`.
- [ ] Unit proof: Fixture file parses as valid JSON; `evidence.site.sourceStatus === "AVAILABLE"`; `evidence.performance.sourceStatus === "AVAILABLE"`; all timestamps are fixed strings (no `new Date()`).
- [ ] Acceptance proof: `scoreAudit()` accepts the fixture without error and returns a complete model.
- [ ] Failure state: Fixture missing required evidence fields → test fail.
- [ ] Prohibited later events/calls/writes: Fixture must not contain live credentials, tokens, or real client data.
- [ ] Final-report evidence: Fixture SHA-256 recorded in acceptance output.

### WP7-DET-05 — Identical evidence produces byte-identical score model output

- [ ] Behaviour: Two `scoreAudit()` calls on the deterministic evidence fixture, when serialized via `JSON.stringify(model, null, 2)`, produce byte-identical output. SHA-256 of serialized output matches.
- [ ] Implementation boundary: Acceptance test `scripts/acceptance-wp7.js`.
- [ ] Unit proof: `model1Str === model2Str` length equality; SHA-256(model1Str) === SHA-256(model2Str).
- [ ] Acceptance proof: Acceptance script runs `scoreAudit()` twice, serializes both, asserts byte equality (not just deep equality).
- [ ] Failure state: Any divergence in any field → test fail with diff.
- [ ] Prohibited later events/calls/writes: Acceptance test must not call live providers or LLMs.
- [ ] Final-report evidence: SHA-256 of deterministic score-model output recorded and identical across runs.

### WP7-DET-06 — Identical evidence produces identical module eligibility

- [ ] Behaviour: `moduleEligibility` map is identical across two `scoreAudit()` calls on identical evidence. Every module's eligibility boolean matches.
- [ ] Implementation boundary: Acceptance test in `scripts/acceptance-wp7.js`.
- [ ] Unit proof: `deepEqual(model1.moduleEligibility, model2.moduleEligibility)`.
- [ ] Acceptance proof: Acceptance test verifies all 10 module eligibility booleans match exactly.
- [ ] Failure state: Any module eligibility mismatch → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Module eligibility map in acceptance output.

### WP7-DET-07 — Identical evidence produces identical findings (IDs, priorities, order)

- [ ] Behaviour: `findings` array is identical across two `scoreAudit()` calls: same length, same `findingId` per position, same `rawPriority`, same `finalPriority`, same order.
- [ ] Implementation boundary: Acceptance test in `scripts/acceptance-wp7.js`.
- [ ] Unit proof: `model1.findings[i].findingId === model2.findings[i].findingId` for all i.
- [ ] Acceptance proof: Acceptance test compares all finding IDs, priorities, and sort order.
- [ ] Failure state: Any finding ID or priority mismatch → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Finding ID array in acceptance output.

### WP7-DET-08 — Identical evidence produces identical dimension and module scores

- [ ] Behaviour: All scores in `model.scores` are identical across two `scoreAudit()` calls. All dimension-level scores (`conversionPathwaysDimension`, `trustEeatDimension`, `contentFunnelDimension`, `technicalPerformanceDimension`, `entitySchemaAiDimension`) match.
- [ ] Implementation boundary: Acceptance test in `scripts/acceptance-wp7.js`.
- [ ] Unit proof: Every key in `model.scores` matches between calls.
- [ ] Acceptance proof: Acceptance test diffs all score fields.
- [ ] Failure state: Any score divergence → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Score values in acceptance output.

### WP7-DET-09 — Identical evidence produces identical assessed weight and evidence confidence

- [ ] Behaviour: `assessedWeight` and `evidenceConfidenceScore` are identical across two `scoreAudit()` calls.
- [ ] Implementation boundary: Acceptance test in `scripts/acceptance-wp7.js`.
- [ ] Unit proof: `model1.assessedWeight === model2.assessedWeight`; `model1.evidenceConfidenceScore === model2.evidenceConfidenceScore`.
- [ ] Acceptance proof: Acceptance test verifies both values match.
- [ ] Failure state: Mismatch in either value → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Assessed weight and evidence confidence in acceptance output.

### WP7-DET-10 — No LLM or non-deterministic scoring operations

- [ ] Behaviour: The complete scoring code path (`vantage-score.js` + `score-components.js`) contains zero LLM calls, zero `Math.random()`, zero `Date.now()` (except the controlled `now` parameter in §DET-02), zero network calls, zero filesystem reads.
- [ ] Implementation boundary: `services/worker/src/scoring/vantage-score.js` and `services/worker/src/scoring/score-components.js`.
- [ ] Unit proof: Static analysis — `grep` for `Math.random`, `Date.now`, `new Date`, `fetch`, `import.*llm`, `openai`, `anthropic` in scoring source files returns zero hits (except the allowed `now` parameter default in `calculateEvidenceConfidence`).
- [ ] Acceptance proof: Acceptance test runs in under 5 seconds with no network access.
- [ ] Failure state: Any non-deterministic or LLM operation detected in scoring path → test fail.
- [ ] Prohibited later events/calls/writes: LLM calls, network calls, `Math.random()`, uncontrolled `Date.now()`/`new Date()`.
- [ ] Final-report evidence: Static analysis output in acceptance log.

### WP7-DET-11 — Deterministic rule IDs for all findings

- [ ] Behaviour: Every finding has a `ruleId` matching `/^VAN-[A-Z]+-\d{3}$/`. Rule IDs are hard-coded in `buildFindings()`, not generated at runtime.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `buildFindings()`.
- [ ] Unit proof: All `ruleId` values in findings array match the pattern. No rule ID is dynamically constructed from variable input.
- [ ] Acceptance proof: Deterministic fixture → identical `ruleId` values across runs.
- [ ] Failure state: Any `ruleId` not matching pattern or dynamically generated → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Rule ID registry in acceptance output.

### WP7-DET-12 — Deterministic finding priorities using frozen priority formula

- [ ] Behaviour: `calculateFindingPriority()` uses the frozen PRD §15.4 formula: `Raw = CI×0.30 + GS×0.25 + BR×0.20 + CS×0.15 + IP×0.10`. Final = Raw × confidence modifier. No other formula is used.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `calculateFindingPriority()`.
- [ ] Unit proof: Priority calculation verified against manual formula for all 5 confidence levels. Edge cases: all-100 = 100, all-0 = 0, overflow clamps to 100.
- [ ] Acceptance proof: Deterministic fixture → identical `rawPriority` and `finalPriority` for every finding.
- [ ] Failure state: Priority formula deviates from PRD §15.4 → test fail.
- [ ] Prohibited later events/calls/writes: Priority formula changes require scoring version bump.
- [ ] Final-report evidence: Priority formula version recorded as `SCORING_VERSION`.

### WP7-DET-13 — Deterministic finding IDs from stable hash

- [ ] Behaviour: `generateFindingId()` produces identical UUID-format IDs for identical `(ruleId, affectedUrls, evidence)` inputs. IDs are UUID v4-formatted.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `generateFindingId()`.
- [ ] Unit proof: Same inputs → same ID; different ruleId → different ID; URL order independence (sorted); UUID format validation.
- [ ] Acceptance proof: Deterministic fixture → all finding IDs match across runs.
- [ ] Failure state: Non-deterministic ID generation → test fail.
- [ ] Prohibited later events/calls/writes: Finding IDs must not depend on insertion order, timestamp, or random values.
- [ ] Final-report evidence: Finding ID hash function documented.

### WP7-DET-14 — Frozen scoring version exposed in all outputs

- [ ] Behaviour: `SCORING_VERSION` constant ("3.0.0") is the single source of truth. `scoringVersion` field in the score model always equals `SCORING_VERSION`. Finding `ruleVersion` fields all equal `SCORING_VERSION`.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` and `services/worker/src/scoring/vantage-score.js`.
- [ ] Unit proof: `model.scoringVersion === "3.0.0"`; all findings have `ruleVersion === "3.0.0"`.
- [ ] Acceptance proof: Acceptance test verifies scoring version in model and all findings.
- [ ] Failure state: Scoring version mismatch or hard-coded duplicate → test fail.
- [ ] Prohibited later events/calls/writes: Scoring version changes require explicit WP authorization.
- [ ] Final-report evidence: Scoring version visible in report scorecard.

---

## WP7 Boundary Rules (from PRD §15 and Prysm prompt)

### WP7-BND-01 — Canonical evidence locked before scoring

- [ ] Behaviour: `scoreAudit()` receives immutable evidence objects. No evidence mutation occurs during scoring. Evidence timestamps are pre-recorded.
- [ ] Implementation boundary: `vantage-score.js` `scoreAudit()`.
- [ ] Unit proof: Evidence object passes `Object.isFrozen()` check or deep-equality before/after scoring.
- [ ] Acceptance proof: Evidence reference equality before and after scoring.
- [ ] Failure state: Evidence mutated during scoring → test fail.
- [ ] Prohibited later events/calls/writes: Evidence mutation during scoring.
- [ ] Final-report evidence: Immutable evidence contract documented.

### WP7-BND-02 — No finding without evidence

- [ ] Behaviour: Every finding in `model.findings` has `evidence.length >= 1`. `buildFindings()` returns early (`return`) when `evidenceRecords.length === 0`.
- [ ] Implementation boundary: `score-components.js` `buildFindings()` `add()` helper.
- [ ] Unit proof: `model.findings.every(f => f.evidence.length >= 1)`.
- [ ] Acceptance proof: Acceptance test verifies all findings have evidence records.
- [ ] Failure state: Any finding with zero evidence records → test fail.
- [ ] Prohibited later events/calls/writes: Findings must not be created from inference without evidence.
- [ ] Final-report evidence: Evidence count per finding in acceptance output.

### WP7-BND-03 — Missing/unavailable evidence does not become zero

- [ ] Behaviour: Performance module returns `null` score when both providers fail. Crawl-dependent modules return `null` when crawl is FAILED/BLOCKED/NOT_CONNECTED. `null` scores are not treated as zero in dimension averaging — they are excluded from the weighted average.
- [ ] Implementation boundary: `vantage-score.js` `scoreModules()` and `buildNotAssessedModel()`.
- [ ] Unit proof: `scorePerformance(unavailablePerf()) === null`; `model.scores.conversionReadiness === null` when crawl FAILED (Insufficient Evidence).
- [ ] Acceptance proof: FAILED crawl → `conversionReadiness: null`, not zero. Both perf providers fail → `performance: null`, not zero.
- [ ] Failure state: Any null-capable score field showing 0 when evidence is missing → test fail.
- [ ] Prohibited later events/calls/writes: `0` in place of `null` for missing-evidence scores.
- [ ] Final-report evidence: Null vs zero distinction visible in score model.

### WP7-BND-04 — Unavailable modules do not silently redistribute weight

- [ ] Behaviour: When a module is ineligible, its weight is excluded from dimension scoring. The dimension score is calculated only from eligible modules' weighted scores. `assessedWeight` reflects the percentage of total intended weight actually scored. The report shows assessed weight percentage.
- [ ] Implementation boundary: `vantage-score.js` `scoreModules()`.
- [ ] Unit proof: Performance FAILED → `assessedWeight === 90` (10% missing); crawl FAILED → `assessedWeight < 60`; dimension scores use only eligible module weights.
- [ ] Acceptance proof: Acceptance test verifies weight arithmetic for at least two scenarios (performance-only failure, crawl failure).
- [ ] Failure state: Missing weight silently added to remaining modules → test fail.
- [ ] Prohibited later events/calls/writes: Weight redistribution without explicit versioned rule change.
- [ ] Final-report evidence: Assessed weight percentage in score model.

### WP7-BND-05 — Assessed weight <80% → readiness provisional

- [ ] Behaviour: When `assessedWeight < 80` and `>= 60`, `readinessStatus === "Provisional"` and `showNumericScore === true`.
- [ ] Implementation boundary: `vantage-score.js` `determineReadinessStatus()`.
- [ ] Unit proof: `determineReadinessStatus(75, 65)` returns `{ status: "Provisional", showNumericScore: true }`.
- [ ] Acceptance proof: Acceptance test with 75% assessed weight scenario (if constructible) or direct function test.
- [ ] Failure state: `assessedWeight` in [60, 80) but status not "Provisional" → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Readiness status visible in score model and report.

### WP7-BND-06 — Assessed weight <60% → suppress overall numeric readiness score

- [ ] Behaviour: When `assessedWeight < 60`, `readinessStatus === "Insufficient Evidence for Overall Score"`, `showNumericScore === false`, and `scores.conversionReadiness === null`.
- [ ] Implementation boundary: `vantage-score.js` `determineReadinessStatus()` and `scoreAudit()`.
- [ ] Unit proof: `determineReadinessStatus(50, null)` returns `{ status: "Insufficient Evidence for Overall Score", showNumericScore: false }`; crawl FAILED → `conversionReadiness === null`.
- [ ] Acceptance proof: FAILED crawl acceptance test verifies `showNumericScore === false` and `conversionReadiness === null`.
- [ ] Failure state: `assessedWeight < 60` but numeric score displayed → test fail.
- [ ] Prohibited later events/calls/writes: Display of numeric score when assessed weight < 60%.
- [ ] Final-report evidence: "Insufficient Evidence for Overall Score" in report scorecard.

### WP7-BND-07 — Both performance providers fail → performance Not Assessed

- [ ] Behaviour: When `performance.sourceStatus` is neither `AVAILABLE` nor `PARTIAL`, the performance module is ineligible, `scores.performance === null`, and `scores.conversionReadiness` excludes performance weight.
- [ ] Implementation boundary: `vantage-score.js` `isPerformanceViable()` and `scoreModules()`.
- [ ] Unit proof: `unavailablePerf()` → `isPerformanceViable() === false`; `model.moduleEligibility.performance === false`.
- [ ] Acceptance proof: Acceptance test with failed performance → performance module in `suppressedModules`, score is null.
- [ ] Failure state: Performance score showing a number when both providers failed → test fail.
- [ ] Prohibited later events/calls/writes: Performance score of 0 when evidence is unavailable.
- [ ] Final-report evidence: Performance module status in suppressed modules list.

### WP7-BND-08 — Zero LLM scoring operations

- [ ] Behaviour: Scoring code path contains no LLM API calls. Redundant with DET-10 but independently verified.
- [ ] Implementation boundary: `services/worker/src/scoring/` directory.
- [ ] Unit proof: `grep -rE 'openai|anthropic|llm|generateText|chat\.completions' services/worker/src/scoring/` returns zero hits.
- [ ] Acceptance proof: Scoring runs without network access.
- [ ] Failure state: Any LLM import or call → test fail.
- [ ] Prohibited later events/calls/writes: LLM API calls in scoring path.
- [ ] Final-report evidence: Static analysis log.

### WP7-BND-09 — Repeatability directly proven

- [ ] Behaviour: The acceptance test runs `scoreAudit()` against the deterministic fixture a minimum of 3 times and proves all 3 outputs are byte-identical.
- [ ] Implementation boundary: `scripts/acceptance-wp7.js`.
- [ ] Unit proof: Three serialized model strings have identical SHA-256.
- [ ] Acceptance proof: `npm run acceptance:wp7` exits 0 with PASS for all repeatability checks.
- [ ] Failure state: Any divergence across 3 runs → test fail.
- [ ] Prohibited later events/calls/writes: None.
- [ ] Final-report evidence: Three-run SHA-256 match in acceptance output.

---

## Verification commands

- [ ] `npm test` — full unit test suite (no live provider/LLM calls)
- [ ] `node --test src/scoring/vantage-score.test.js` — WP7 scoring tests
- [ ] `npm run test:schemas` — schema validation
- [ ] `npm run acceptance:wp2` — WP2 schema acceptance
- [ ] `npm run acceptance:wp3` — WP3 artifact acceptance
- [ ] `npm run acceptance:wp4` — WP4 state machine acceptance
- [ ] `npm run acceptance:wp5` — WP5 orchestrator acceptance
- [ ] `npm run acceptance:wp6` — WP6 adapter acceptance
- [ ] `npm run check:template` — template integrity
- [ ] `node scripts/acceptance-wp7.js` — WP7 acceptance (deterministic proof)
- [ ] Static analysis: `grep -rE 'Math\.random|Date\.now|new Date|fetch|openai|anthropic' services/worker/src/scoring/` — zero hits except allowed controlled `now` parameter

---

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
