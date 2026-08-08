# Prysm WP7 Checklist — Deterministic Findings and Scores

**Version:** 1.0.0
**Branch:** feat/prysm-wp7-deterministic-findings-scores
**PR:** TBD
**Required starting SHA:** 46653ea4fc5a1df594156997419b473600cfae59
**Objective:** Starting only from validated, locked Canonical Evidence, deterministically produce evidence-backed findings and governed scores, persist the governed outputs, and reach `SCORED` without changing the client-facing report or invoking n8n, an LLM, deployment, or live providers.
**Baseline active cycle time:** TBD (first governed WP7 cycle)
**55% target active cycle time:** TBD

## Permitted files

- [ ] `CLAUDE.md` — status metadata only
- [ ] `docs/prysm-governance/work-packages/WP7_CHECKLIST.md`
- [ ] `services/worker/src/scoring/**`
- [ ] `services/worker/src/orchestration/audit-orchestrator.js` — only the minimum canonical-evidence/scoring integration required by frozen WP7 IDs
- [ ] `services/worker/test-fixtures/orchestration/orchestrator.test.js` — WP7 regression proof only
- [ ] `services/worker/test-fixtures/wp7/**`
- [ ] `services/worker/scripts/acceptance-wp7.js`
- [ ] `services/worker/scripts/wp7-*.js`
- [ ] `services/worker/package.json` — scripts only
- [ ] `.github/workflows/worker-ci.yml` — WP7 verification/acceptance integration only

## Prohibited files

- [ ] `services/worker/src/contracts/**`
- [ ] `services/worker/src/report/**`
- [ ] `services/worker/src/n8n/**`
- [ ] `services/n8n/**`
- [ ] adapter production implementations
- [ ] provider clients
- [ ] WP3 Artifact Store production implementation
- [ ] WP4 lifecycle state definitions or transition map
- [ ] database migrations
- [ ] Railway/deployment files
- [ ] credentials/environment configuration
- [ ] WP8 or later work-package files

---

## Requirements

### WP7-LOCK-01 — Locked evidence is the only scoring input

- [ ] Behaviour: Scoring must execute only from validated Canonical Evidence associated with an audit at `EVIDENCE_LOCKED`. Scoring from `EVIDENCE_LOCKED` succeeds; scoring before `EVIDENCE_LOCKED` rejects; scoring does not invoke any provider adapter; scoring does not read provider-specific raw payloads as its decision input.
- [ ] Implementation boundary: `services/worker/src/scoring/vantage-score.js` `scoreAudit()`, `services/worker/src/scoring/scoring-service.js`.
- [ ] Unit proof: `scoreAudit()` receives only canonical evidence (site, performance, ga4, gsc, backlinks, competitors) — no raw provider payloads. Scoring service loads canonical evidence from artifact store, never calls adapters.
- [ ] Acceptance proof: Scoring path loads canonical evidence from artifact store; provider adapter call count during scoring = 0.
- [ ] Failure state: Attempt to score before EVIDENCE_LOCKED → reject.
- [ ] Prohibited later events/calls/writes: Provider adapter calls during scoring.
- [ ] Final-report evidence: Adapter call count = 0 during scoring path.

### WP7-LOCK-02 — Canonical evidence contains normalized scoring evidence

- [ ] Behaviour: The locked Canonical Evidence used by WP7 must contain the normalized evidence required by eligible deterministic modules. Controlled website evidence survives canonical assembly; controlled performance evidence survives canonical assembly; optional source evidence/statuses survive where applicable; canonical evidence validates against the existing WP2 Canonical Evidence contract; exact canonical bytes and SHA remain unchanged after lock.
- [ ] Implementation boundary: `services/worker/test-fixtures/scoring/deterministic-evidence-fixture.json`.
- [ ] Unit proof: Fixture validates against canonical-evidence.schema.json; fixture contains site, performance, ga4, gsc, backlinks, competitors with correct sourceStatus values; all timestamps are fixed ISO-8601 strings.
- [ ] Acceptance proof: `scoreAudit()` accepts the fixture without error and returns a complete model.
- [ ] Failure state: Fixture missing required evidence fields → test fail.
- [ ] Prohibited later events/calls/writes: Fixture must not contain live credentials, tokens, or real client data.

### WP7-GATE-01 — Module source gates are exact

- [ ] Behaviour: A module scores only when its required source evidence satisfies its governed eligibility rules. AVAILABLE allows the dependent module when other requirements pass; PARTIAL follows the documented completeness rules; FAILED, BLOCKED, UNAVAILABLE, NOT_CONNECTED and NOT_APPLICABLE never become an automatic zero score; an unavailable optional source affects only dependent analysis.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `checkModuleEligibility()`, `services/worker/src/scoring/vantage-score.js` `scoreModules()`.
- [ ] Unit proof: `checkModuleEligibility(MODULES.trust_signals, evidenceWithFailedCrawl)` → `{ eligible: false, reason: includes "FAILED" }`. `checkModuleEligibility(MODULES.performance, evidenceWithFailedPerf)` → `{ eligible: false }`. FAILED crawl → all crawl-dependent modules ineligible. NOT_CONNECTED backlinks → does not affect any dimension score.
- [ ] Acceptance proof: FAILED crawl → `conversionReadiness: null`, not zero. Both perf providers fail → `performance: null`, not zero. Performance FAILED → crawl-dependent scores unaffected.
- [ ] Failure state: Any null-capable score field showing 0 when evidence is missing → test fail.
- [ ] Prohibited later events/calls/writes: `0` in place of `null` for missing-evidence scores.

### WP7-FIND-01 — Every finding has evidence

- [ ] Behaviour: Every emitted finding must validate against the frozen Finding contract and contain at least one real evidence reference/value from canonical evidence. A valid governed finding passes schema validation; attempted finding generation without supporting evidence emits no finding or rejects according to the frozen contract; no finding is invented from missing provider data.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `buildFindings()` `add()` helper.
- [ ] Unit proof: `model.findings.every(f => f.evidence.length >= 1)`. Every finding has `provider`, `sourceStatus`, `field`, `observedValue`, `artifactRef` in each evidence record. `buildFindings()` with empty evidence returns early.
- [ ] Acceptance proof: FAILED crawl → zero findings (no evidence = no findings). Every finding in acceptance fixture has ≥1 evidence record.
- [ ] Failure state: Any finding with zero evidence records → test fail.
- [ ] Prohibited later events/calls/writes: Findings must not be created from inference without evidence.

### WP7-FIND-02 — Finding identifiers are deterministic

- [ ] Behaviour: Identical rule version, affected URLs and evidence produce the exact same finding identifier. Repeated execution gives exact equality; affected URL ordering cannot change the identifier when the governed finding is semantically identical.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `generateFindingId()`.
- [ ] Unit proof: Same inputs → same ID; different ruleId → different ID; URL order independence (sorted); UUID format validation (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`).
- [ ] Acceptance proof: Three-run acceptance → all finding IDs match across all runs.
- [ ] Failure state: Non-deterministic ID generation → test fail.
- [ ] Prohibited later events/calls/writes: Finding IDs must not depend on insertion order, timestamp, or random values.

### WP7-SCORE-01 — Assessed weight is calculated from eligible completed modules only

- [ ] Behaviour: Assessed weight equals the exact intended weight represented by eligible completed modules; suppressed modules contribute zero assessed weight; missing modules are not redistributed into remaining modules.
- [ ] Implementation boundary: `services/worker/src/scoring/vantage-score.js` `scoreModules()`.
- [ ] Unit proof: 100% eligible → `assessedWeight === 100`. Performance FAILED (10% of total) → `assessedWeight === 90`. Crawl FAILED → `assessedWeight < 60`.
- [ ] Acceptance proof: Acceptance test verifies weight arithmetic for at least two scenarios.
- [ ] Failure state: Missing weight silently added to remaining modules → test fail.
- [ ] Prohibited later events/calls/writes: Weight redistribution without explicit versioned rule change.

### WP7-SCORE-02 — No silent reweighting

- [ ] Behaviour: A missing module retains its intended missing weight; below 80% assessed weight is labelled `Provisional`; below 60% assessed weight suppresses the overall numeric readiness score; at or above 80% follows the governed complete-score behaviour.
- [ ] Implementation boundary: `services/worker/src/scoring/vantage-score.js` `determineReadinessStatus()`.
- [ ] Unit proof: `determineReadinessStatus(90, 65)` → `{ status: "Complete", showNumericScore: true }`. `determineReadinessStatus(75, 55)` → `{ status: "Provisional", showNumericScore: true }`. `determineReadinessStatus(50, null)` → `{ status: "Insufficient Evidence for Overall Score", showNumericScore: false }`.
- [ ] Acceptance proof: FAILED crawl → `showNumericScore === false`, `conversionReadiness === null`, `readinessStatus === "Insufficient Evidence for Overall Score"`.
- [ ] Failure state: `assessedWeight < 60` but numeric score displayed → test fail.
- [ ] Prohibited later events/calls/writes: Display of numeric score when assessed weight < 60%.

### WP7-CONF-01 — Evidence confidence is independent from readiness

- [ ] Behaviour: Evidence Confidence must be calculated separately from Conversion Readiness using the governed evidence-confidence factors. Optional-source absence does not automatically lower unrelated readiness; confidence changes when governed evidence sufficiency changes; readiness and evidence-confidence values remain independently observable. Any time-dependent confidence calculation must use a deterministic timestamp derived from locked evidence or an injected deterministic clock.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `calculateEvidenceConfidence()`.
- [ ] Unit proof: Same evidence with same `now` parameter → identical confidence score and `dataFreshness`. Different `now` values → different freshness scores. `calculateEvidenceConfidence()` accepts optional `now` parameter (ISO-8601 or epoch ms).
- [ ] Acceptance proof: Deterministic fixture → identical `evidenceConfidenceScore` across two runs. NOT_CONNECTED optional sources → readiness unaffected.
- [ ] Failure state: `Date.now()` called inside `calculateEvidenceConfidence()` production path without controlled override → test fail.
- [ ] Prohibited later events/calls/writes: Optional-source absence lowering unrelated readiness scores.

### WP7-PRIO-01 — Finding priority uses the governed deterministic formula

- [ ] Behaviour: Raw Priority = Conversion Impact × 0.30 + Gap Severity × 0.25 + Business Relevance × 0.20 + Competitive Signal × 0.15 + Implementation Practicality × 0.10. Final Priority = Raw Priority × governed confidence modifier. Deterministic = 1.00, strongly supported = 0.90, supported = 0.75, directional = 0.55, insufficient is not score-bearing.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` `calculateFindingPriority()`.
- [ ] Unit proof: All 5 confidence levels verified against manual formula. All-100 = 100. All-0 = 0. Overflow clamps to 100. `CONFIDENCE_MODIFIERS` match PRD §15.4 exactly.
- [ ] Acceptance proof: Deterministic fixture → identical `rawPriority` and `finalPriority` for every finding across runs.
- [ ] Failure state: Priority formula deviates from PRD §15.4 → test fail.
- [ ] Prohibited later events/calls/writes: Priority formula changes require scoring version bump.

### WP7-VERS-01 — Version identifiers are explicit and stable

- [ ] Behaviour: The governed outputs must expose the applicable contract/scoring/rule versions required by the frozen contracts. `SCORING_VERSION` constant ("3.0.0") is the single source of truth. `model.scoringVersion === "3.0.0"`. All findings have `ruleVersion === "3.0.0"`.
- [ ] Implementation boundary: `services/worker/src/scoring/score-components.js` and `services/worker/src/scoring/vantage-score.js`.
- [ ] Unit proof: `model.scoringVersion === "3.0.0"`; all findings have `ruleVersion === "3.0.0"`. All `ruleId` values match `/^VAN-[A-Z]+-\d{3}$/`.
- [ ] Acceptance proof: Repeated scoring preserves exact identifiers.
- [ ] Failure state: Scoring version mismatch or hard-coded duplicate → test fail.
- [ ] Prohibited later events/calls/writes: Scoring version changes require explicit WP authorization.

### WP7-ART-01 — Findings artifact is persisted and verified

- [ ] Behaviour: Persist the governed findings under the tenant/client/audit `canonical` artifact boundary using the existing WP3 Artifact Store. Required artifact name: `findings.json`. Stored bytes equal produced bytes; stored SHA-256 equals SHA-256 of produced bytes; read-back verification succeeds; tenant/client/audit key scope is exact.
- [ ] Implementation boundary: `services/worker/src/scoring/scoring-service.js` `persistFindings()`.
- [ ] Unit proof: `store.put()` called with `category: "canonical"`, `artifactName: "findings.json"`. `store.verify(record)` returns `true`. Read-back bytes equal written bytes.
- [ ] Acceptance proof: Acceptance test persists findings, reads back, verifies bytes and SHA-256 match.
- [ ] Failure state: Write failure → operation rejects, no partial artifact.
- [ ] Prohibited later events/calls/writes: Findings artifact written outside canonical category.

### WP7-ART-02 — Scores artifact is persisted and verified

- [ ] Behaviour: Persist the governed Score Set under the same `canonical` artifact boundary. Required artifact name: `scores.json`. Score Set validates against the frozen WP2 Score contract; stored bytes equal produced bytes; stored SHA-256 equals SHA-256 of produced bytes; read-back verification succeeds.
- [ ] Implementation boundary: `services/worker/src/scoring/scoring-service.js` `persistScores()`.
- [ ] Unit proof: `store.put()` called with `category: "canonical"`, `artifactName: "scores.json"`. `store.verify(record)` returns `true`. Read-back bytes equal written bytes.
- [ ] Acceptance proof: Acceptance test persists scores, reads back, verifies bytes and SHA-256 match.
- [ ] Failure state: Write failure → operation rejects, no partial artifact.
- [ ] Prohibited later events/calls/writes: Scores artifact written outside canonical category.

### WP7-LIFE-01 — Successful governed scoring reaches SCORED

- [ ] Behaviour: After both governed canonical output artifacts are successfully persisted and verified: `EVIDENCE_LOCKED → SCORED`. Exact ordered lifecycle equality; transition occurs only after both verified writes; lifecycle event contains the governed scoring artifact reference required by existing lifecycle conventions.
- [ ] Implementation boundary: `services/worker/src/orchestration/audit-orchestrator.js` scoring step, `services/worker/src/scoring/scoring-service.js`.
- [ ] Unit proof: Lifecycle history shows exact ordered `["evidence_locked", "scored"]` tail. Transition occurs only after both artifact writes succeed.
- [ ] Acceptance proof: Full scoring path → lifecycle reaches `SCORED`. Lifecycle event contains scoring artifact key reference.
- [ ] Failure state: Artifact write fails → lifecycle remains at `EVIDENCE_LOCKED`.
- [ ] Prohibited later events/calls/writes: `SCORED` event when any artifact write failed.

### WP7-FAIL-01 — Scoring failure fails closed

- [ ] Behaviour: If finding generation, score validation, artifact writing or artifact verification fails: operation rejects; persisted lifecycle state remains exactly `EVIDENCE_LOCKED`; `SCORED` event does not exist; narrative calls = 0; n8n calls = 0; report writes = 0; deployment calls = 0.
- [ ] Implementation boundary: `services/worker/src/scoring/scoring-service.js`, orchestrator scoring step.
- [ ] Unit proof: Artifact store write failure → lifecycle state unchanged (`EVIDENCE_LOCKED`). No `SCORED` lifecycle event exists. Scoring service throws on validation failure.
- [ ] Acceptance proof: Simulated artifact write failure → lifecycle remains `EVIDENCE_LOCKED`, no SCORED event, no downstream calls.
- [ ] Failure state: Do not invent a new lifecycle failure state.
- [ ] Prohibited later events/calls/writes: n8n calls, report writes, deployment calls during scoring failure.

### WP7-REPLAY-01 — Identical locked evidence is exactly repeatable

- [ ] Behaviour: Using one static controlled Canonical Evidence fixture, run the complete governed WP7 path repeatedly. Exact finding IDs equal; exact finding ordering equal; exact finding values equal; exact priorities equal; exact score values equal; exact assessed weight equal; exact evidence confidence equal; exact version identifiers equal; exact serialized findings bytes equal; exact serialized scores bytes equal; exact SHA-256 values equal.
- [ ] Implementation boundary: `services/worker/scripts/acceptance-wp7.js`, `services/worker/src/scoring/scoring-service.js`.
- [ ] Unit proof: Three-run byte-identical output (SHA-256 match). All finding IDs, priorities, scores, assessed weight, evidence confidence match.
- [ ] Acceptance proof: `npm run acceptance:wp7` exits 0 with PASS for all repeatability checks.
- [ ] Failure state: Any divergence across 3 runs → test fail.
- [ ] Prohibited later events/calls/writes: None.

### WP7-REPLAY-02 — Scoring replay makes zero collection calls

- [ ] Behaviour: When a valid audit is already `EVIDENCE_LOCKED`, execution of the WP7 scoring path must: call all provider adapters zero times; make zero live network calls; make zero LLM calls; write no report artifacts; leave canonical evidence unchanged.
- [ ] Implementation boundary: `services/worker/src/orchestration/audit-orchestrator.js` scoring step.
- [ ] Unit proof: Adapter call count = 0 during EVIDENCE_LOCKED → SCORED replay. Network call count = 0. LLM call count = 0.
- [ ] Acceptance proof: Scoring replay path verified with zero provider adapter calls.
- [ ] Failure state: Any adapter called during scoring replay → test fail.
- [ ] Prohibited later events/calls/writes: Provider calls, network calls, LLM calls, report writes during scoring replay.

### WP7-REG-01 — Existing governed behaviour remains green

- [ ] Behaviour: Schema suite PASS; artifact suite PASS; lifecycle suite PASS; orchestrator suite PASS; WP2 acceptance PASS; WP3 acceptance PASS; WP4 acceptance PASS; WP5 acceptance PASS; WP6 acceptance PASS; full worker regression PASS; report template integrity PASS.
- [ ] Implementation boundary: All existing governed modules.
- [ ] Unit proof: All existing test suites pass with zero failures.
- [ ] Acceptance proof: `npm run wp7:verify` exits 0.
- [ ] Failure state: Any existing test regression → BLOCKED.
- [ ] Prohibited later events/calls/writes: None.

### WP7-LOCK-REPORT-01 — Client-facing report remains byte-for-byte governed

- [ ] Behaviour: No file under `services/worker/src/report/**` changed; template/golden-master integrity check passes; no HTML, CSS, report section, report page, navigation, footer, header, CTA, print behaviour or visual design changes.
- [ ] Implementation boundary: `services/worker/src/report/**` (untouched).
- [ ] Unit proof: `git diff origin/main..HEAD -- services/worker/src/report/` is empty. `check:template` exits 0.
- [ ] Acceptance proof: Template integrity check PASS.
- [ ] Failure state: Any report file changed → BLOCKED.
- [ ] Prohibited later events/calls/writes: Report file modifications.

### WP7-SCOPE-01 — WP7 changes only authorized files

- [ ] Behaviour: Exact changed-file list matches permitted files only. Prohibited-file scan passes. No generated runtime artifacts. No credentials. No live-provider or LLM test path.
- [ ] Implementation boundary: Repository-wide diff against `origin/main`.
- [ ] Unit proof: `git diff origin/main..HEAD --name-only` ⊆ permitted files.
- [ ] Acceptance proof: `npm run wp7:scope-check` exits 0.
- [ ] Failure state: Any prohibited file changed → BLOCKED.
- [ ] Prohibited later events/calls/writes: Prohibited file modifications.

---

## Verification commands

- [ ] `npm run check:template` — template integrity
- [ ] `npm run test:schemas` — schema validation
- [ ] `npm run test:artifacts` — artifact store tests
- [ ] `npm run test:lifecycle` — lifecycle tests
- [ ] `npm run test:orchestrator` — orchestrator tests
- [ ] `npm run test:wp7` — WP7 unit tests
- [ ] `npm run acceptance:wp2` — WP2 acceptance
- [ ] `npm run acceptance:wp3` — WP3 acceptance
- [ ] `npm run acceptance:wp4` — WP4 acceptance
- [ ] `npm run acceptance:wp5` — WP5 acceptance
- [ ] `npm run acceptance:wp6` — WP6 acceptance
- [ ] `npm run acceptance:wp7` — WP7 acceptance
- [ ] `npm run wp7:preflight` — branch/SHA/clean-tree preflight
- [ ] `npm run wp7:scope-check` — permitted/prohibited file check
- [ ] `npm run wp7:verify` — full WP7 verification (all of the above)
- [ ] `npm test` — full worker regression

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
