# Prysm WP10 Checklist — Locked Renderer

**Version:** 1.0.0
**Branch:** feat/prysm-wp10-locked-renderer
**PR:** TBD
**Required starting SHA:** d3cf84b91a40037466e9cd2d59dd5320717cca23
**Objective:** Build the locked renderer boundary from validated WP8 ReportContentPackage + WP9 NarrativeResponse through ReportViewModel, governed draft rendering, approval and publication while preserving the frozen client-facing report design exactly.
**Baseline active cycle time:** 1.9h (median of WP6:1.9h, WP7:4h, WP8:1.5h)
**55% target active cycle time:** 0.86h

## Permitted files

- [ ] `CLAUDE.md` — WP10 status metadata only
- [ ] `docs/prysm-governance/work-packages/WP10_CHECKLIST.md`
- [ ] `services/worker/src/report-view-model/**`
- [ ] `services/worker/src/orchestration/audit-orchestrator.js`
- [ ] `services/worker/src/storage/report-store.js`
- [ ] `services/worker/src/server.js`
- [ ] `services/worker/test-fixtures/wp10/**`
- [ ] `services/worker/test-fixtures/orchestration/orchestrator.test.js`
- [ ] `services/worker/scripts/acceptance-wp10.js`
- [ ] `services/worker/scripts/wp10-preflight.js`
- [ ] `services/worker/scripts/wp10-scope-check.js`
- [ ] `services/worker/scripts/wp10-verify.js`
- [ ] `services/worker/package.json` — scripts only
- [ ] `.github/workflows/worker-ci.yml` — WP10 verification only

## Prohibited / READ-ONLY

- [ ] `services/worker/src/contracts/**`
- [ ] `services/worker/src/report/**`
- [ ] `services/worker/src/narrative/**`
- [ ] `services/worker/src/n8n/**`
- [ ] `services/worker/src/scoring/**`
- [ ] `services/worker/src/adapters/**`
- [ ] `services/worker/src/lifecycle/**`
- [ ] `services/n8n/**`
- [ ] `report-golden-master/**`
- [ ] `services/worker/migrations/**`
- [ ] `railway.toml`
- [ ] credential/environment files

---

## Requirements

### WP10-RVM-01 — ReportViewModel from verified WP8 + WP9 artifacts

- [ ] Behaviour: Only schema-valid WP8 ReportContentPackage and schema-valid WP9 NarrativeResponse may produce a schema-valid ReportViewModel against report-view-model.schema.json. Invalid input must produce RENDER_FAILED with zero renderer calls and zero successful report writes.
- [ ] Implementation boundary: `services/worker/src/report-view-model/build-view-model.js`
- [ ] Unit proof: Valid inputs → schema-valid ReportViewModel. Invalid package → throws before any renderer call, renderer call count = 0. Invalid narrative → throws, renderer call count = 0.
- [ ] Acceptance proof: Acceptance exercises both valid and invalid paths, counts renderer invocations, checks lifecycle state.
- [ ] Failure state: NARRATIVE_READY → RENDER_FAILED for invalid input. Lifecycle shows RENDER_FAILED with zero draft/approved artifacts.
- [ ] Prohibited later events/calls/writes: No DRAFT_RENDERED. No renderer call. No report write.
- [ ] Final-report evidence: Renderer call counter = 0 for invalid input. Lifecycle history ends with RENDER_FAILED.

### WP10-LOCK-01 — Locked renderer/design asset integrity

- [ ] Behaviour: Locked renderer/design assets must change by exactly zero bytes. Prove SHA-256 equality against the starting baseline.
- [ ] Implementation boundary: `services/worker/src/report-view-model/` — lock verification
- [ ] Unit proof: Compute SHA-256 of karen-leslie-template.html, render-report.js, render-approved-report.js, section files. Compare to hardcoded baseline.
- [ ] Acceptance proof: Lock verification script produces SHA-256 values; git diff confirms zero bytes changed in report/.
- [ ] Failure state: Any SHA mismatch → lock verification fails loudly, blocks rendering.
- [ ] Prohibited later events/calls/writes: No render if lock verification fails.
- [ ] Final-report evidence: SHA-256 values recorded, git diff for services/worker/src/report/ empty.

### WP10-PAGE-01 — Exact governed page structure

- [ ] Behaviour: Successful rendering must produce the exact governed/golden-master page structure: 15 content pages + 1 index page = 16 files. Every page must have shared navigation, business name, audit date, page title, approval status, scoring version, and print button.
- [ ] Implementation boundary: Uses existing `renderApprovedReport()` from `services/worker/src/report/render-approved-report.js` (READ-ONLY).
- [ ] Unit proof: Run renderApprovedReport with valid ReportViewModel → 16 files, correct filenames, all section IDs present, navigation links correct.
- [ ] Acceptance proof: Rendered pages verified for structure, navigation, metadata, print controls.
- [ ] Failure state: Missing section → render fails entirely, zero partial writes.
- [ ] Prohibited later events/calls/writes: No partial approved-report writes.
- [ ] Final-report evidence: Page count = 16, filenames match APPROVED_PAGES list + index.html.

### WP10-RENDER-FAIL-01 — Injected render failure proves fail-closed

- [ ] Behaviour: Injected required-page rendering/write failure must prove: NARRATIVE_READY → RENDER_FAILED. No DRAFT_RENDERED state. No partial client-accessible report.
- [ ] Implementation boundary: `services/worker/scripts/acceptance-wp10.js` — injected failure scenario
- [ ] Unit proof: Inject page-write failure → lifecycle shows RENDER_FAILED, no DRAFT_RENDERED event, renderer call count for failed page = 1 attempt with zero persisted artifacts for that page.
- [ ] Acceptance proof: Acceptance exercises injected write failure, reads lifecycle history, proves zero files written.
- [ ] Failure state: RENDER_FAILED. No DRAFT_RENDERED. Zero partial artifacts.
- [ ] Prohibited later events/calls/writes: No DRAFT_RENDERED. No partial page writes.
- [ ] Final-report evidence: Lifecycle history = [NARRATIVE_READY, RENDER_FAILED]. Store directory empty.

### WP10-MANIFEST-01 — ReportArtifactManifest validates against frozen contract

- [ ] Behaviour: The ReportArtifactManifest must validate against report-manifest.schema.json and correspond exactly to successfully persisted artifacts. Prove using artifact-store read-back, byte counts and SHA-256.
- [ ] Implementation boundary: `services/worker/src/report-view-model/` — manifest builder
- [ ] Unit proof: Build manifest from rendered pages → validates against schema. Read-back each artifact → byte count matches, SHA-256 matches.
- [ ] Acceptance proof: Manifest JSON passes schema validation. Every file entry exists in artifact store with matching bytes + SHA.
- [ ] Failure state: Manifest validation failure → no approval or publish.
- [ ] Prohibited later events/calls/writes: No manifest written without complete verified artifact set.
- [ ] Final-report evidence: Manifest schema validation PASS. Byte counts and SHA-256 for each file.

### WP10-DRAFT-01 — Draft and IN_REVIEW not client-deliverable

- [ ] Behaviour: DRAFT_RENDERED and IN_REVIEW reports must not be client-deliverable. Prove through actual route execution, not source inspection.
- [ ] Implementation boundary: `services/worker/src/server.js` — report delivery route gating
- [ ] Unit proof: HTTP GET /reports/:slug/:runId/index.html with lifecycle status = draft → 403. Status = reviewed → 403. Status = approved → 200.
- [ ] Acceptance proof: Acceptance script starts server, makes HTTP requests to routes with different lifecycle states, checks exact response codes.
- [ ] Failure state: 403 for draft, 403 for reviewed, 200 only for approved.
- [ ] Prohibited later events/calls/writes: No draft/reviewed report served.
- [ ] Final-report evidence: HTTP response codes for each lifecycle status.

### WP10-APPROVAL-01 — Approval gate rules

- [ ] Behaviour: Only IN_REVIEW (via lifecycle transition DRAFT_RENDERED→IN_REVIEW) may become APPROVED. Rejected/incomplete approval must become APPROVAL_REJECTED. A missing required page must prevent approval.
- [ ] Implementation boundary: `services/worker/src/orchestration/audit-orchestrator.js` and `services/worker/src/server.js`
- [ ] Unit proof: IN_REVIEW→APPROVED with complete review checklist → PASS. IN_REVIEW→APPROVED with incomplete review → APPROVAL_REJECTED. Missing page → approval rejected. Non-IN_REVIEW status → approval rejected.
- [ ] Acceptance proof: Acceptance exercises complete approval path with review, exercises rejection with incomplete review, exercises rejection with missing page.
- [ ] Failure state: APPROVAL_REJECTED for invalid approval. Lifecycle history shows transition to APPROVAL_REJECTED.
- [ ] Prohibited later events/calls/writes: No APPROVED state without complete review. No PUBLISHED without APPROVED.
- [ ] Final-report evidence: Lifecycle history shows exact ordered transitions.

### WP10-PUBLISH-01 — Publication gate rules

- [ ] Behaviour: Only a complete APPROVED artifact set may become PUBLISHED. Injected publication failure must become PUBLISH_FAILED and expose no partial publication.
- [ ] Implementation boundary: `services/worker/src/orchestration/audit-orchestrator.js`
- [ ] Unit proof: APPROVED→PUBLISHED with complete artifacts → PASS. APPROVED→PUBLISHED with injected failure → PUBLISH_FAILED. Non-APPROVED→PUBLISHED → rejected.
- [ ] Acceptance proof: Acceptance exercises both successful publication and injected failure, verifies lifecycle history and zero partial artifacts.
- [ ] Failure state: PUBLISH_FAILED. Zero partial publication.
- [ ] Prohibited later events/calls/writes: No partial published artifacts. No PUBLISHED state on failure.
- [ ] Final-report evidence: Lifecycle history. Artifact read-back.

### WP10-REPLAY-01 — Deterministic replay

- [ ] Behaviour: Identical ReportViewModel hash + reportDesignVersion must produce identical rendered output hashes and zero provider, LLM or n8n calls.
- [ ] Implementation boundary: `services/worker/src/report-view-model/` — replay verification
- [ ] Unit proof: Build view model, render twice → identical output SHA-256. Provider call count = 0. LLM call count = 0. n8n call count = 0.
- [ ] Acceptance proof: Two renderings with identical input → identical output hashes.
- [ ] Failure state: N/A (positive proof only).
- [ ] Prohibited later events/calls/writes: N/A (zero external calls).
- [ ] Final-report evidence: SHA-256 identical across two renders. Call counters at zero.

### WP10-GM-01 — Golden-master structural verification

- [ ] Behaviour: Golden-master structural, style, visual and print verification must PASS with zero modification to golden-master assets.
- [ ] Implementation boundary: `services/worker/scripts/wp10-verify.js` — golden-master verification
- [ ] Unit proof: Rendered pages match expected section count, CSS rules include print media, navigation markup present, print button present.
- [ ] Acceptance proof: Golden-master verification passes — 15 sections present, print CSS detected, nav present, print button present on every page.
- [ ] Failure state: Any structural deviation → FAIL.
- [ ] Prohibited later events/calls/writes: Zero golden-master file modifications.
- [ ] Final-report evidence: Structural checks all PASS. Zero golden-master file changes.

### WP10-REG-01 — Prior acceptance green

- [ ] Behaviour: WP2–WP9 suites remain green.
- [ ] Implementation boundary: All existing governed modules (untouched).
- [ ] Acceptance proof: `npm run wp10:verify` exits 0.

### WP10-ZERO-01 — Zero live calls during WP10

- [ ] Behaviour: live provider calls=0, live LLM calls=0, live n8n calls=0, live cost=$0.00.
- [ ] Implementation boundary: All WP10 modules.
- [ ] Unit proof: Acceptance runs with zero network access.
- [ ] Acceptance proof: Acceptance suite verifies zero live calls.

### WP10-SCOPE-01 — Only permitted files changed

- [ ] Behaviour: Only frozen permitted files changed. No credentials, generated junk, WP11+ files.
- [ ] Implementation boundary: Repository-wide diff.
- [ ] Acceptance proof: `npm run wp10:scope-check` exits 0.

---

## Verification commands

- [ ] `npm run check:template` — template integrity
- [ ] `npm run test:schemas` — schema validation
- [ ] `npm run test:artifacts` — artifact tests
- [ ] `npm run test:lifecycle` — lifecycle tests
- [ ] `npm run test:orchestrator` — orchestrator tests
- [ ] `npm run test:wp10` — WP10 unit tests
- [ ] `npm run acceptance:wp2` through `acceptance:wp9` — prior acceptance
- [ ] `npm run acceptance:wp10` — WP10 acceptance
- [ ] `npm run wp10:preflight` — branch/SHA/clean-tree
- [ ] `npm run wp10:scope-check` — permitted/prohibited file check
- [ ] `npm run wp10:verify` — full WP10 verification
- [ ] `npm test` — full worker regression

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
