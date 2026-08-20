# PRYSM Narrative v2 — Production Path Gate

Change ID: `PRYSM-NARRATIVE-V2-PROD-01`
Version: `1.0.0`
Release intent: `CHANGE_ONLY`
Production activation: **disabled by default**

## Objective

Connect the already-proven Narrative v2 Writer → Judge → governed renderer stack to the production audit lifecycle without changing evidence collection, scoring, provider behavior, the existing v1 report path, or the existing report-design-v2 path when Narrative v2 is not explicitly selected.

This gate does **not** bind a live model client, enable Narrative v2 in `server.js`, deploy, merge, or execute a paid provider/LLM call.

## Frozen activation contract

Narrative v2 executes only when BOTH conditions are true:

1. the production runtime is constructed with `narrativeV2.enabled === true` and both governed executor seams (`writerExecutor`, `judgeExecutor`); and
2. the persisted AuditRequest explicitly carries:
   - `report.designVersion === "2.0.0"`; and
   - `report.narrativeVersion === "2.0.0"`.

`report.narrativeVersion` is versioned in the AuditRequest contract:

- `1.0.0` — existing production narrative/render path;
- `2.0.0` — governed Narrative v2 path.

Default remains `1.0.0`.

## Fail-closed rules

The change MUST NOT silently fall back after an explicit Narrative v2 request.

- Explicit `narrativeVersion: 2.0.0` with the runtime capability disabled → request rejected before persistence/execution.
- Enabled runtime missing Writer or Judge executor → startup rejected.
- Narrative v2 requested with report design other than `2.0.0` → request rejected.
- Invalid WriterOutput/Judge output/orchestration → no client report.
- Terminal orchestration status other than `RELEASE_CANDIDATE` → lifecycle stops at the governed narrative failure boundary; no client report.
- Persisted release-candidate artifacts are revalidated before rendering.
- A render retry reuses the persisted WriterInput/orchestration result; it does not automatically spend another Writer/Judge execution set.

## Lifecycle composition

The proven base audit orchestrator is not modified.

For every request except explicit Narrative v2, the production wrapper delegates to it unchanged.

For explicit Narrative v2:

1. collection/evidence/scoring remain owned by the base orchestrator;
2. at `SCORED`, the wrapper loads the exact persisted governed inputs;
3. the deterministic ReportContentPackage remains produced for compatibility/audit continuity;
4. the legacy WP9 narrative execution is bypassed for this versioned path;
5. WriterInput is built from the persisted AuditRequest + ScoreSet + FindingSet + CapabilityEvidence;
6. the governed three-pass Writer/Judge controller runs through injected executor seams;
7. WriterInput and the complete orchestration result are persisted in the non-client `report-v2/narrative-v2/` audit namespace;
8. only `RELEASE_CANDIDATE` transitions to `NARRATIVE_READY`;
9. rendering reloads/revalidates the persisted release candidate and overlays it on the deterministic v2 report;
10. successful composition transitions to `DRAFT_RENDERED` through the existing report-v2 artifact contract.

## Single canonical data rule

Narrative v2 uses the exact persisted canonical artifacts:

- `canonical/audit-request.json`
- `canonical/scores.json`
- `canonical/findings.json`
- governed DecisionEvidence
- governed CapabilityEvidence

No aliases, reconstructed source observations, guessed values, or provider-derived prose are introduced.

## Production projection discrepancy corrected

Inspection found one concrete active-lifecycle data-loss defect: the prior v2 rendering projection omitted two fields already preserved in the persisted ScoreSet:

- `readinessStatusDetail`
- `renderingDiagnostics`

The Narrative v2 production bridge builds its deterministic report model directly from the persisted ScoreSet and carries both fields through. No score or evidence value is changed.

## Existing report preservation

Narrative v2 rendering must preserve the complete deterministic v2 report underneath the new executive narrative layer, including the Karen-style depth regression already proven by PR #66.

The default `designVersion: 2.0.0` path with Narrative v2 unselected must remain on the existing report output and must not invoke the new Writer or Judge executors.

## Recovery rules

- `NARRATIVE_PENDING` + verified persisted release candidate → recover to `NARRATIVE_READY` without Writer/Judge re-execution.
- `NARRATIVE_PENDING` without a terminal orchestration artifact → governed re-execution is allowed, matching the existing interruption model.
- `NARRATIVE_FAILED` does not automatically trigger another Narrative v2 execution set.
- `RENDER_FAILED` may recover to `NARRATIVE_READY`, then re-render from persisted Narrative v2 artifacts without Writer/Judge re-execution.

## Protected boundaries

This change MUST NOT:

- modify `services/worker/src/orchestration/audit-orchestrator.js`;
- modify provider adapters or provider configuration;
- modify evidence acquisition/hydration contracts;
- modify scoring logic or score thresholds;
- modify the v1 renderer;
- change the existing v2 renderer contract;
- bind any live Writer/Judge model client in `server.js`;
- enable Narrative v2 in production by default;
- call a live provider or LLM in tests;
- merge or deploy automatically.

## Deterministic proof

`narrative-v2-production-path.test.js` must prove at minimum:

1. disabled runtime rejects explicit Narrative v2 rather than silently falling back;
2. enabled + explicit opt-in executes one controlled first-pass Writer/Judge pair and reaches `DRAFT_RENDERED` with the narrative layer present;
3. exact AuditRequest, WriterInput and orchestration artifacts are persisted;
4. explicit Narrative v2 bypasses the legacy WP9 narrative artifact;
5. missing Writer/Judge executor rejects runtime construction;
6. existing report-design-v2 default path invokes neither new executor and contains no Narrative v2 layer;
7. `readinessStatusDetail` and `renderingDiagnostics` survive the production-model projection.

All proof uses deterministic controlled adapters and injected Writer/Judge functions. Paid provider calls: `0`. Live LLM calls: `0`.

## Frozen scope

Authorized files:

- `services/worker/src/contracts/audit-request.schema.json`
- `services/worker/src/application/production-runtime.js`
- `services/worker/src/narrative-v2/production-path.js`
- `services/worker/src/application/narrative-v2-production-path.test.js`
- `.governance/changes/PRYSM-NARRATIVE-V2_PRODUCTION_PATH_CHECKLIST.md`

No other file is authorized without a new scope decision.