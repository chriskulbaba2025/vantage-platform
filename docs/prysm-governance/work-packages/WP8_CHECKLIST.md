# Prysm WP8 Checklist — Compact Report Content Package

**Version:** 1.0.0
**Branch:** feat/prysm-wp8-report-content-package
**PR:** TBD
**Required starting SHA:** be9b53f2688cb3d0aa63ae3daba7e0d0c248a933
**Objective:** Build the deterministic Compact Report Content Package from governed post-WP7 inputs (canonical evidence + findings + scores). The package is the sole future n8n narrative payload boundary. It must validate against the frozen report-content.schema.json and persist via the WP3 Artifact Store.
**Baseline active cycle time:** 4h (median of WP5: 5.8h, WP6: 1.9h, WP7: 4h)
**55% target active cycle time:** 1.8h

## Permitted files

- [ ] `CLAUDE.md` — status metadata only
- [ ] `docs/prysm-governance/work-packages/WP8_CHECKLIST.md`
- [ ] `services/worker/src/report-content/**`
- [ ] `services/worker/test-fixtures/wp8/**`
- [ ] `services/worker/scripts/acceptance-wp8.js`
- [ ] `services/worker/scripts/wp8-preflight.js`
- [ ] `services/worker/scripts/wp8-scope-check.js`
- [ ] `services/worker/scripts/wp8-verify.js`
- [ ] `services/worker/package.json` — scripts only
- [ ] `.github/workflows/worker-ci.yml` — WP8 verification integration only
- [ ] `services/worker/src/orchestration/audit-orchestrator.js` — minimal SCORED→NARRATIVE_PENDING integration only if required by WP8-LIFE-01

## Prohibited files

- [ ] `services/worker/src/contracts/**`
- [ ] `services/worker/src/report/**`
- [ ] `services/worker/src/n8n/**`
- [ ] `services/worker/src/scoring/**`
- [ ] `services/worker/src/adapters/**`
- [ ] `services/worker/src/lifecycle/**` (except reading state enum)
- [ ] `services/worker/src/storage/**` (except calling governed artifact store)
- [ ] `services/n8n/**`
- [ ] `report-golden-master/**`
- [ ] database migrations
- [ ] Railway/deployment files
- [ ] credentials/environment configuration

---

## Requirements

### WP8-INPUT-01 — Operates only from governed post-WP7 inputs

- [ ] Behaviour: ReportContentPackage generation operates only from locked canonical evidence + persisted/validated findings + persisted/validated scores. No provider execution. No score/finding recomputation.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Function signature accepts `(canonicalEvidence, findings, scoreSet, opts)`. Zero imports from adapters, providers, or LLM libraries.
- [ ] Acceptance proof: Package built from fixture inputs without calling any adapter.
- [ ] Failure state: Attempt to build package with missing inputs → reject.
- [ ] Prohibited later events/calls/writes: Provider calls, score recomputation, finding generation.

### WP8-SCHEMA-01 — Validates against report-content.schema.json

- [ ] Behaviour: Generated package validates against `report-content.schema.json` with `additionalProperties: false` honoured. Do not modify the WP2 contract.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: AJV validate(package) returns `valid: true` with zero errors.
- [ ] Acceptance proof: Acceptance test validates package against schema; `additionalProperties: false` catches extra properties.
- [ ] Failure state: Schema-invalid package → reject, fail closed.
- [ ] Prohibited later events/calls/writes: Schema modification.

### WP8-IDENT-01 — Audit/business identity from governed data

- [ ] Behaviour: `auditId`, `business.name`, `business.domain`, `business.platform` are deterministic and originate from canonical evidence + audit request.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: `business.name` matches input audit request; `business.domain` derived from canonical evidence site domain.
- [ ] Acceptance proof: Identical inputs → identical identity fields.
- [ ] Failure state: Missing identity fields → schema validation fail.
- [ ] Prohibited later events/calls/writes: Identity from non-governed sources.

### WP8-SCORE-01 — Scores copied without reinterpretation

- [ ] Behaviour: All score fields, bands, readinessStatus, assessedWeight, evidenceConfidenceScore, rootCause are copied from the locked ScoreSet without recalculation or silent reweighting.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Every score field in package equals corresponding ScoreSet field. Numeric precision unchanged.
- [ ] Acceptance proof: Byte comparison of score fields between input ScoreSet and output package.
- [ ] Failure state: Score field in package differs from ScoreSet → test fail.
- [ ] Prohibited later events/calls/writes: Score recalculation, weight redistribution.

### WP8-FIND-01 — Only existing governed finding IDs

- [ ] Behaviour: Only finding IDs present in the validated FindingSet may appear. The package cannot create, remove, reinterpret or renumber findings. `findings` array in package is a subset of FindingSet.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Every `findingId` in package exists in input FindingSet. No new findingIds generated.
- [ ] Acceptance proof: Package findingIds ⊆ input FindingSet findingIds.
- [ ] Failure state: Finding ID not in FindingSet → test fail.
- [ ] Prohibited later events/calls/writes: Finding creation, deletion, or modification.

### WP8-FIND-02 — Finding facts are deterministic and traceable

- [ ] Behaviour: Finding factual fields (title, severity, confidence, scoreBearing, businessImpact, recommendation, verificationMethod, affectedUrls, evidence, implementationEffort) are copied deterministically from FindingSet. Identical inputs → identical finding facts.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Every finding in package has exact same fields as corresponding FindingSet entry for the fields required by schema.
- [ ] Acceptance proof: Three-run byte comparison of finding fields.
- [ ] Failure state: Finding field value differs from FindingSet → test fail.
- [ ] Prohibited later events/calls/writes: Finding fact modification, narrative injection.

### WP8-SECT-01 — Fixed deterministic section assignments

- [ ] Behaviour: Section assignments are fixed and deterministic. Identical governed inputs always produce identical section assignment and ordering. Findings are assigned to sections based on dimension/module mapping.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Same inputs → same section assignment map. Section order is fixed.
- [ ] Acceptance proof: Three-run section assignment comparison.
- [ ] Failure state: Non-deterministic section assignment → test fail.
- [ ] Prohibited later events/calls/writes: Dynamic section creation.

### WP8-SECT-02 — Section assignment controls no visual layout

- [ ] Behaviour: Section assignment cannot create new report sections and cannot control HTML, CSS, page order, component placement, typography, spacing, colours or visual layout. Section assignments are logical groupings only.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Section assignment output contains no HTML tags, CSS properties, layout instructions, or page directives. Output is a plain string-to-findingIds map.
- [ ] Acceptance proof: Static analysis of section assignment output.
- [ ] Failure state: HTML/CSS/layout in section assignment → test fail.
- [ ] Prohibited later events/calls/writes: Layout control via section assignment.

### WP8-STATUS-01 — Source-status summary preserves governed states

- [ ] Behaviour: `sourceStatus` object preserves governed source states: website, performance, competitors, backlinks, ga4, gsc. Available states: AVAILABLE, PARTIAL, FAILED, BLOCKED, UNAVAILABLE, NOT_CONNECTED, NOT_APPLICABLE. Missing data not converted to false zero.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: `sourceStatus.website === evidence.site.sourceStatus` etc. for all 6 sources. Missing source → NOT_CONNECTED.
- [ ] Acceptance proof: Source status map verified for all 6 sources across multiple status scenarios.
- [ ] Failure state: Source status fabricated or missing source converted to AVAILABLE → test fail.
- [ ] Prohibited later events/calls/writes: Source status mutation.

### WP8-LIMIT-01 — Limitations are deterministic facts

- [ ] Behaviour: Limitations are derived from governed evidence/source limitations. They are facts, not generated narrative. Gathered from canonical evidence limitations arrays.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Every limitation in package is present in canonical evidence or score set limitations. No invented limitations.
- [ ] Acceptance proof: Three-run limitation comparison — identical inputs → identical limitation arrays.
- [ ] Failure state: Invented limitation → test fail.
- [ ] Prohibited later events/calls/writes: Narrative limitation generation.

### WP8-NARR-01 — Narrative limits are fixed and machine-enforced

- [ ] Behaviour: `promptVersion` and `outputSchemaVersion` are fixed constants. The package tells future narrative generation what bounded fields may be populated, but contains no generated narrative itself.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: `promptVersion === "1.0.0"`, `outputSchemaVersion === "1.0.0"`. No narrative text fields present.
- [ ] Acceptance proof: Package contains promptVersion and outputSchemaVersion; zero narrative prose fields.
- [ ] Failure state: Generated narrative text in package → test fail.
- [ ] Prohibited later events/calls/writes: Narrative generation in WP8.

### WP8-RAW-01 — No raw provider payload, secrets, or layout

- [ ] Behaviour: No raw provider payload, provider response dump, secret, credential, debug log, HTML, CSS or screenshot is present anywhere in the package.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Static analysis — package JSON contains zero keys matching `_sourceStatus`, `rawArtifactRef`, `_crawlSuppressed`, `evidence`. No HTML tags in any string field.
- [ ] Acceptance proof: Package schema validated with additionalProperties:false rejects extra properties.
- [ ] Failure state: Raw payload, secret, or HTML/CSS found → test fail.
- [ ] Prohibited later events/calls/writes: Raw data leakage into package.

### WP8-N8N-01 — ReportContentPackage is the sole future n8n boundary

- [ ] Behaviour: WP8 must not invoke n8n or make network/LLM calls. The package is the payload boundary for future WP9 n8n integration.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Zero imports from n8n modules. Zero fetch/network calls. Zero LLM imports.
- [ ] Acceptance proof: Static analysis confirms zero n8n/LLM/network references in report-content/.
- [ ] Failure state: n8n/network/LLM call during package build → test fail.
- [ ] Prohibited later events/calls/writes: n8n invocation, network calls, LLM calls.

### WP8-HASH-01 — Deterministic byte-identical output

- [ ] Behaviour: Identical governed inputs produce byte-identical canonical ReportContentPackage output and identical SHA-256.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: `JSON.stringify(pkg1) === JSON.stringify(pkg2)` and `SHA256(pkg1) === SHA256(pkg2)`.
- [ ] Acceptance proof: Three-run acceptance with byte comparison and SHA-256 match.
- [ ] Failure state: Non-identical bytes or SHA mismatch → test fail.
- [ ] Prohibited later events/calls/writes: Non-deterministic serialization.

### WP8-ART-01 — Persist and verify via Artifact Store

- [ ] Behaviour: Persist exact package bytes at `report/report-content.json` using the governed WP3 Artifact Store. Read back and verify bytes + SHA before recording success.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: `store.put()` called with `category: "report"`, `artifactName: "report-content.json"`. `store.verify(record)` returns true. Read-back bytes equal written bytes.
- [ ] Acceptance proof: Artifact persistence, read-back, and SHA verification.
- [ ] Failure state: Write/read/verify failure → operation rejects.
- [ ] Prohibited later events/calls/writes: Artifact written without verification.

### WP8-REPLAY-01 — Three-run exact repeatability

- [ ] Behaviour: Three runs from identical fixtures produce identical field values, finding order, section assignments, limitations, source statuses, versions, serialized bytes, and SHA-256.
- [ ] Implementation boundary: `services/worker/scripts/acceptance-wp8.js`
- [ ] Unit proof: `run1 === run2 && run2 === run3` at byte level.
- [ ] Acceptance proof: `npm run acceptance:wp8` exits 0 with three-run SHA match.
- [ ] Failure state: Any divergence → test fail.
- [ ] Prohibited later events/calls/writes: None.

### WP8-FAIL-01 — Fail closed on invalid input or artifact failure

- [ ] Behaviour: Invalid input, schema-invalid output or artifact verification failure must fail closed. No narrative call, report render, deployment or later pipeline action may occur after failure.
- [ ] Implementation boundary: `services/worker/src/report-content/build-package.js`
- [ ] Unit proof: Missing required input → throws. Schema validation failure → throws. Artifact write failure → throws. Artifact verify failure → throws.
- [ ] Acceptance proof: Simulated failures → no downstream effects, no artifact written, no state transition.
- [ ] Failure state: Silent failure → test fail.
- [ ] Prohibited later events/calls/writes: Downstream pipeline actions after failure.

### WP8-LIFE-01 — SCORED → NARRATIVE_PENDING transition

- [ ] Behaviour: Per the authoritative pipeline contract §11, SCORED → NARRATIVE_PENDING is the next normal-path transition after scoring. The ReportContentPackage completion enables narrative generation. If the contract assigns this to successful package completion, implement SCORED → NARRATIVE_PENDING. If ambiguous, document with evidence and do not change lifecycle.
- [ ] Implementation boundary: `services/worker/src/orchestration/audit-orchestrator.js` (if implemented); otherwise this checklist item is documentary.
- [ ] Unit proof: Lifecycle history includes NARRATIVE_PENDING after successful package build + artifact persistence (if implemented).
- [ ] Acceptance proof: Acceptance test verifies transition (if implemented) or documents contract ambiguity.
- [ ] Failure state: Transition attempted without verified package persistence → reject (if implemented).
- [ ] Prohibited later events/calls/writes: NARRATIVE_PENDING without verified artifact (if implemented).

### WP8-LOCK-REPORT-01 — Zero client-facing report changes

- [ ] Behaviour: Zero client-facing report files changed. Golden-master/template hashes remain unchanged.
- [ ] Implementation boundary: `services/worker/src/report/**` (untouched).
- [ ] Unit proof: `git diff origin/main..HEAD -- services/worker/src/report/` is empty.
- [ ] Acceptance proof: `npm run check:template` exits 0 with unchanged hashes.
- [ ] Failure state: Any report file changed → BLOCKED.
- [ ] Prohibited later events/calls/writes: Report file modifications.

### WP8-REG-01 — Prior acceptance suites remain green

- [ ] Behaviour: All WP2–WP7 tests and acceptance suites remain green. Schema, artifact, lifecycle, orchestrator, and scoring tests pass.
- [ ] Implementation boundary: All existing governed modules.
- [ ] Unit proof: `npm test` passes. All acceptance:wp2 through acceptance:wp7 pass.
- [ ] Acceptance proof: `npm run wp8:verify` exits 0.
- [ ] Failure state: Any prior test regression → BLOCKED.
- [ ] Prohibited later events/calls/writes: None.

### WP8-SCOPE-01 — Only frozen permitted files changed

- [ ] Behaviour: Only permitted files changed. Zero prohibited files, generated junk, credentials, live calls or unrelated changes.
- [ ] Implementation boundary: Repository-wide diff against `origin/main`.
- [ ] Unit proof: `git diff origin/main..HEAD --name-only` ⊆ permitted files.
- [ ] Acceptance proof: `npm run wp8:scope-check` exits 0.
- [ ] Failure state: Prohibited file changed → BLOCKED.
- [ ] Prohibited later events/calls/writes: Prohibited file modifications.

---

## Verification commands

- [ ] `npm run check:template` — template integrity
- [ ] `npm run test:schemas` — schema validation
- [ ] `npm run test:artifacts` — artifact store tests
- [ ] `npm run test:lifecycle` — lifecycle tests
- [ ] `npm run test:orchestrator` — orchestrator tests
- [ ] `npm run test:wp8` — WP8 unit tests
- [ ] `npm run acceptance:wp2` through `acceptance:wp7` — prior acceptance
- [ ] `npm run acceptance:wp8` — WP8 acceptance
- [ ] `npm run wp8:preflight` — branch/SHA/clean-tree preflight
- [ ] `npm run wp8:scope-check` — permitted/prohibited file check
- [ ] `npm run wp8:verify` — full WP8 verification
- [ ] `npm test` — full worker regression

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
