# Prysm WP9 Checklist — Governed Narrative Workflow

**Version:** 1.1.0  (corrected — v1.0.0 had independently confirmed false-positive audit)
**Branch:** feat/prysm-wp9-narrative-workflow
**PR:** #40
**Required starting SHA:** 7e3a992d23b31a353b225a9b1715b458bd11b00c
**Objective:** Implement the governed narrative boundary: ReportContentPackage → NarrativeResponse. Mock/replay/live modes, cache, cost controls, validation, repair, ledger, and SCORED→NARRATIVE_PENDING→NARRATIVE_READY lifecycle.
**Baseline active cycle time:** 1.9h (median of WP6:1.9h, WP7:4h, WP8:1.5h)
**55% target active cycle time:** 0.86h

## Existing n8n disposition (Gate 2)

| File | Disposition |
|---|---|
| `services/worker/src/n8n/prepare-payload.js` | REPLACE (superseded by WP8 buildReportContentPackage) |
| `services/worker/src/n8n/prepare-payload.test.js` | NOT USED BY WP9 |
| `services/worker/src/n8n/build-report.js` | NOT USED BY WP9 |
| `services/worker/src/n8n/generate-zip.js` | NOT USED BY WP9 |
| `services/worker/src/n8n/prysm-n8n-workflow.json` | KEEP (untouched legacy; WP9 creates versioned candidate) |

## Permitted files

- [ ] `CLAUDE.md` — status metadata only
- [ ] `docs/prysm-governance/work-packages/WP9_CHECKLIST.md`
- [ ] `services/worker/src/narrative/**` — new WP9 narrative service
- [ ] `services/worker/test-fixtures/wp9/**` — WP9 test fixtures
- [ ] `services/worker/scripts/acceptance-wp9.js`
- [ ] `services/worker/scripts/wp9-preflight.js`
- [ ] `services/worker/scripts/wp9-scope-check.js`
- [ ] `services/worker/scripts/wp9-verify.js`
- [ ] `services/worker/package.json` — scripts only
- [ ] `.github/workflows/worker-ci.yml` — WP9 verification only

## Prohibited files

- [ ] `services/worker/src/contracts/**`
- [ ] `services/worker/src/report/**`
- [ ] `services/worker/src/scoring/**`
- [ ] `services/worker/src/report-content/**`
- [ ] `services/worker/src/adapters/**`
- [ ] `services/worker/src/lifecycle/**` (except reading state enum)
- [ ] `services/worker/src/storage/**` (except calling governed artifact store)
- [ ] `services/n8n/**`
- [ ] `report-golden-master/**`
- [ ] `services/worker/src/n8n/prysm-n8n-workflow.json` (legacy untouched)

---

## Requirements

### WP9-INPUT-01 — Only schema-valid WP8 ReportContentPackage accepted
- [ ] Behaviour: Narrative workflow accepts only a schema-valid ReportContentPackage. Invalid input rejected before any model call.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Schema-invalid package → throws before model call. Model call count = 0.
- [ ] Acceptance proof: Invalid package scenario → reject, zero calls.

### WP9-HASH-01 — Package hash locked before execution
- [ ] Behaviour: SHA-256 of ReportContentPackage computed/verified before narrative execution. Must remain unchanged.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Hash computed once, verified at end. Mutation during execution detected.
- [ ] Acceptance proof: Package hash recorded in ledger.

### WP9-LINEAR-01 — Workflow is linear and bounded
- [ ] Behaviour: No loops, autonomous agents, sub-agents, recursive workflows, model debates, open-ended retries, repeated scoring, or automatic escalation.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Code path analysis — single call chain, no while/for loops around model calls, no recursive functions.
- [ ] Acceptance proof: Static analysis confirms bounded execution.

### WP9-MODE-01 — Three explicit modes
- [ ] Behaviour: mock, replay, live. Mode must be explicit. Live never automatic fallback.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Undefined mode → throws. Mode="live" when default is mock → rejected unless explicit.

### WP9-MOCK-01 — Mock mode deterministic, zero calls
- [ ] Behaviour: Mock mode produces deterministic placeholder NarrativeResponse. Zero network/model calls.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: 3-run mock → identical output. Model call count = 0.

### WP9-REPLAY-01 — Replay uses stored response, zero cost
- [ ] Behaviour: Exact cache hit → return stored validated NarrativeResponse. Zero model calls.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Store response, replay → same response returned. Call count = 0. Cost = $0.00.

### WP9-CACHE-01 — Cache key from governed inputs
- [ ] Behaviour: `SHA256(reportContentHash + promptVersion + modelId + outputSchemaVersion)`
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Same inputs → same cache key. Different package hash → different key.

### WP9-COST-01 — Cost preflight before live call
- [ ] Behaviour: Estimate input tokens, max output tokens, max possible cost. Reject if hard ceiling exceeded.
- [ ] Implementation boundary: `services/worker/src/narrative/cost-preflight.js`
- [ ] Unit proof: Token estimate > max → reject. Cost > hard budget → reject. Tests use injected price table.

### WP9-BUDGET-01 — Configurable budget controls
- [ ] Behaviour: Respect PRYSM_LLM_SOFT_BUDGET_USD, PRYSM_LLM_HARD_BUDGET_USD, PRYSM_LLM_DAILY_HARD_BUDGET_USD. No real credentials.
- [ ] Implementation boundary: `services/worker/src/narrative/cost-preflight.js`
- [ ] Unit proof: Above hard budget → reject. Above daily budget → reject. Tests use injected config.

### WP9-MODEL-01 — Configurable model ID
- [ ] Behaviour: Model ID configurable, not hardcoded. Architecture allows least-expensive passing model.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Different modelId → different cache key. Model selection via config.

### WP9-CALL-01 — Hard call limits
- [ ] Behaviour: primary ≤ 1, repair ≤ 1, total ≤ 2. No automatic escalation. Network retry ≤ 1.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Third call attempt → throws. Escalation path absent.

### WP9-VALID-01 — NarrativeResponse schema validation
- [ ] Behaviour: Response validates against narrative-response.schema.json with additionalProperties:false.
- [ ] Implementation boundary: `services/worker/src/narrative/validate-narrative.js`
- [ ] Unit proof: Valid response → passes. Extra property → fails.

### WP9-VALID-02 — Content validation
- [ ] Behaviour: Required fields present. Finding IDs match package. No new URLs. Score unchanged. Word limits. No HTML/CSS. Field completeness.
- [ ] Implementation boundary: `services/worker/src/narrative/validate-narrative.js`
- [ ] Unit proof: Invented finding ID → reject. New URL → reject. HTML → reject. Score mutation → reject.

### WP9-FACT-01 — No new factual claims
- [ ] Behaviour: Narrative cannot create new factual claims outside governed ReportContentPackage.
- [ ] Implementation boundary: `services/worker/src/narrative/validate-narrative.js`
- [ ] Unit proof: Validation rejects claims not grounded in package facts.

### WP9-REPAIR-01 — Single repair only
- [ ] Behaviour: One repair after validation failure. Input: original facts + invalid response + errors. After failed repair → NARRATIVE_FAILED.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Repair count > 1 → throws. Failed repair → NARRATIVE_FAILED.

### WP9-LEDGER-01 — Usage/cost ledger
- [ ] Behaviour: Record auditId, executionId, workflowVersion, nodeId, mode, modelId, promptVersion, inputTokens, outputTokens, cachedInputTokens, estimatedCost, actualCost, retryNumber, cacheHit, validationResult, timestamp. Deterministic timestamps in tests.
- [ ] Implementation boundary: `services/worker/src/narrative/usage-ledger.js`
- [ ] Unit proof: Mock run → ledger entry with cacheHit=false, actualCost=0. Replay → cacheHit=true, actualCost=0.

### WP9-ART-01 — Narrative artifact persisted and verified
- [ ] Behaviour: Persist at `report/narrative.json`. Read back and verify bytes + SHA.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: store.put() called with category:"report", artifactName:"narrative.json". store.verify() returns true.

### WP9-LIFE-01 — Orchestrator owns SCORED → NARRATIVE_PENDING → NARRATIVE_READY
- [ ] Behaviour: Per pipeline contract §11, ONLY the orchestrator changes audit state. Narrative-service validates, executes, and returns governed success/failure. Orchestrator invokes narrative execution, persists artifact, and performs: SCORED→NARRATIVE_PENDING→NARRATIVE_READY on success. On failure: NARRATIVE_PENDING→NARRATIVE_FAILED. Do not alter lifecycle enum or transition map.
- [ ] Implementation boundary: `services/worker/src/orchestration/audit-orchestrator.js` owns lifecycle transitions. `services/worker/src/narrative/narrative-service.js` returns result/error only — does NOT call lifecycle.
- [ ] Unit proof: Orchestrator integration test shows exact ordered lifecycle tail [SCORED, NARRATIVE_PENDING, NARRATIVE_READY]. Narrative-service test proves zero lifecycle calls.
- [ ] Acceptance proof: Acceptance exercises orchestrator path and verifies lifecycle history.

### WP9-FAIL-01 — Fail closed on narrative failure
- [ ] Behaviour: NARRATIVE_PENDING → NARRATIVE_FAILED. No renderer, report write, deployment. Failed repair → NARRATIVE_FAILED.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Validation failure after repair → NARRATIVE_FAILED state.

### WP9-WFVER-01 — Workflow metadata recorded
- [ ] Behaviour: workflow version, prompt version, model ID, input/output schema versions, max calls, max tokens, test fixture, benchmark status (not yet run), rollback reference recorded.
- [ ] Implementation boundary: `services/worker/src/narrative/narrative-service.js`
- [ ] Unit proof: Metadata object contains all required fields. Benchmark status = "NOT_RUN".

### WP9-N8N-01 — Versioned inactive n8n workflow candidate
- [ ] Behaviour: Versioned candidate exists at `services/worker/src/n8n/prysm-narrative-workflow-v1.1.0.json`. active=false. Webhook authentication required. Input validation fails closed (validates worker-provided validation proof + package hash). Cache hit routes to replay path, never mock. Explicit mock/replay/live routes. Live model endpoint validated before HTTP call (strict hostname allowlist, HTTPS only, no localhost/loopback/private IP). Primary call ≤1, repair ≤1, no recursive path, no agent, no scoring/provider/rendering nodes, no credentials embedded, no remote activation.
- [ ] Implementation boundary: `services/worker/src/n8n/prysm-narrative-workflow-v1.1.0.json`
- [ ] Unit proof: Structural graph tests — parse JSON, verify active=false, auth present, cache-hit→replay edge, mock path separate, endpoint validation node exists, node count, credential scan, graph cycle check.
- [ ] Acceptance proof: Workflow JSON structural validation suite passes.

### WP9-PROMPT-01 — Prompt is short, fixed, versioned
- [ ] Behaviour: Prompt requests only narrative-response fields. No conversation history, raw evidence, code, HTML, CSS, debug data.
- [ ] Implementation boundary: `services/worker/src/narrative/prompt-template.js`
- [ ] Unit proof: Prompt contains no evidence dumps, code blocks, HTML tags.

### WP9-ZERO-01 — Zero live calls during WP9
- [ ] Behaviour: live provider calls=0, live LLM calls=0, live n8n calls=0, live cost=$0.00.
- [ ] Implementation boundary: All WP9 modules.
- [ ] Unit proof: Mock/replay only. Static analysis confirms zero live endpoints.
- [ ] Acceptance proof: Acceptance runs with zero network access.

### WP9-REG-01 — Prior acceptance green
- [ ] Behaviour: WP2–WP8 suites remain green.
- [ ] Implementation boundary: All existing governed modules (untouched).
- [ ] Acceptance proof: `npm run wp9:verify` exits 0.

### WP9-LOCK-REPORT-01 — Zero report changes
- [ ] Behaviour: Zero report template/CSS/assets/layout changes. Golden-master unchanged.
- [ ] Implementation boundary: `services/worker/src/report/**` (untouched).
- [ ] Acceptance proof: check:template PASS. git diff empty for report/.

### WP9-SCOPE-01 — Only permitted files changed
- [ ] Behaviour: Only frozen permitted files. No credentials, generated junk, WP10+ files.
- [ ] Implementation boundary: Repository-wide diff.
- [ ] Acceptance proof: `npm run wp9:scope-check` exits 0.

---

## Verification commands

- [ ] `npm run check:template` — template integrity
- [ ] `npm run test:schemas` — schema validation
- [ ] `npm run test:artifacts` — artifact tests
- [ ] `npm run test:lifecycle` — lifecycle tests
- [ ] `npm run test:orchestrator` — orchestrator tests
- [ ] `npm run test:wp9` — WP9 unit tests
- [ ] `npm run acceptance:wp2` through `acceptance:wp8` — prior acceptance
- [ ] `npm run acceptance:wp9` — WP9 acceptance
- [ ] `npm run wp9:preflight` — branch/SHA/clean-tree
- [ ] `npm run wp9:scope-check` — permitted/prohibited file check
- [ ] `npm run wp9:verify` — full WP9 verification
- [ ] `npm test` — full worker regression

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
