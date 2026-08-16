# Prysm PRYSM-NEXT-01 / WP-C Checklist — Capability Evidence V2

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** 03d9f6e (post WP-B)
**Objective:** One measurable outcome — a versioned capability-evidence layer (capabilityEvidenceVersion 2.0.0) exists as an additive canonical artifact that truthfully reports AVAILABLE/PARTIAL/UNAVAILABLE/FAILED/NOT_CONNECTED/NOT_APPLICABLE per capability with coverage, provenance and limitations; unknown data is never converted to false/zero/empty; malformed score-bearing evidence fails closed; historical decision-evidence v1.0.0 stays readable.
**Baseline active cycle time (written estimate):** 4.0h. **55% target:** ≤ 1.8h.

## Permitted files

- [x] `.governance/changes/**`
- [x] `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPC_CHECKLIST.md`
- [x] `services/worker/src/contracts/capability-evidence.schema.json` (new)
- [x] `services/worker/src/contracts/validator.js` (REQUIRED_SCHEMAS registry entry ONLY)
- [x] `services/worker/src/evidence/capability-evidence.js` (new)
- [x] `services/worker/src/evidence/capability-evidence.test.js` (new)
- [x] `services/worker/src/evidence/decision-evidence.js` (hydrateSite: `_contentEvidenceAvailable` truthfulness passthrough + adapterVersion provenance ONLY)
- [x] `services/worker/src/evidence/decision-evidence.test.js` (assert the new passthrough semantics)
- [x] `services/worker/src/orchestration/audit-orchestrator.js` (additive step 5c build+persist ONLY)
- [x] `services/worker/test-fixtures/contracts/valid/capability-evidence.valid.json` (new — required by validator suite §every schema has fixtures)
- [x] `services/worker/test-fixtures/contracts/invalid/capability-evidence.invalid.json` (new — same)
- [x] `services/worker/scripts/acceptance-wp5.js`, `scripts/acceptance-wp6.js`, `scripts/acceptance-wp10.js` (proof-only harness corrections per §15.2: real-schema lists + guarded validators now include capability-evidence.schema.json; required because the orchestrator persists capability evidence in the production path)

## Prohibited files

- [x] `services/worker/src/scoring/**`, `services/worker/src/report/**`, `services/worker/src/narrative/**`
- [x] `services/worker/src/contracts/*.schema.json` EXCEPT capability-evidence (new)
- [x] `services/worker/src/lifecycle/**`, `services/worker/migrations/**`, `app/**`, `lib/**`, `tests/**`, `.github/**`
- [x] `**/golden-master/**`

## Requirements

### WP-C-01 — Versioned capability-evidence contract
- [x] Behaviour: `capability-evidence.schema.json` exists: $id under /contracts/v1/, contractVersion 1.0.0, capabilityEvidenceVersion const "2.0.0"; 13 capabilities listed in the matrix doc; status enum = the canonical 7-status vocabulary; per-capability coverage/provenance/limitations/requiredFieldsPresent required.
- [x] Boundary: contracts/capability-evidence.schema.json
- [x] Unit proof: schema compiles via compileAllSchemas; valid fixture passes; invalid fixture (missing requiredFieldsPresent) fails — capability-evidence.test.js.
- [x] Failure state: non-conforming artifact rejected by AJV (test).

### WP-C-02 — Capability derivation engine
- [x] Behaviour: `buildCapabilityEvidence({ decisionEvidence, auditId, generatedAt })` derives all 13 capabilities deterministically: content.body, offer.clarity, trust.proof, conversion.cta, conversion.form, conversion.path, technical.indexability, technical.redirects, technical.resources, technical.headers, schema.structured_data, performance.lab, performance.field. Rules are evidence-driven (WP-B acquisition ledgers, `_contentEvidenceAvailable` strict equality, schema/microdata types, performance statuses, fieldData presence). conversion.path carries kind:"inferred" + validated:false (WP-E upgrades to validated).
- [x] Boundary: evidence/capability-evidence.js (new)
- [x] Unit proof: truth-table tests (WP-C-05) with exact per-capability statuses.
- [x] Failure state: malformed input (contentParsing not array, acquisition missing) → capability FAILED + limitation, never throws; identical input → identical output (determinism test).

### WP-C-03 — Unknown ≠ absent at hydration
- [x] Behaviour: hydrateSite no longer coerces `_contentEvidenceAvailable` to false — undefined passes through as undefined (absent ≠ false); adapterVersion added for provenance. Downstream scoring semantics unchanged for legacy shapes (undefined !== false ⇒ true path) — proven by regression.
- [x] Boundary: evidence/decision-evidence.js hydrateSite
- [x] Unit proof: decision-evidence.test.js asserts undefined passthrough + adapterVersion; full regression green.

### WP-C-04 — Persistence + fail-closed validation
- [x] Behaviour: `persistCapabilityEvidence` + `loadAndValidateCapabilityEvidence` mirror the decision-evidence contract: schema validate → put (category canonical, artifactName capability-evidence.json) → read-back byte check → SHA-256 check → store.verify. Loader: artifact missing/corrupt/schema-invalid → throw.
- [x] Boundary: evidence/capability-evidence.js
- [x] Unit proof: round-trip via memory artifact store; corrupt artifact rejected; invalid artifact rejected (tests).

### WP-C-05 — Missing/partial/contradictory evidence truth tables
- [x] Behaviour: test matrix covering: full evidence; partial content; no content; no schema; no headers; no performance; partial performance; partial page coverage; provider failure; conflicting signals (contentParsing completed but no main content; microdata empty but schemaTypes present). Documented in `.governance/changes/PRYSM-NEXT-01_CAPABILITY_MATRIX.md`.
- [x] Boundary: capability-evidence.test.js + matrix doc
- [x] Unit proof: each named case asserts exact capability statuses (no `A OR B`).

### WP-C-06 — Orchestrator additive integration
- [x] Behaviour: orchestrator step 5c builds + persists capability evidence after decision evidence, before the canonical manifest; errors from persistence propagate (fail closed); return value includes capabilityEvidenceRecord; resume/idempotency unaffected (no lifecycle changes).
- [x] Boundary: orchestration/audit-orchestrator.js
- [x] Unit proof: acceptance-prysm + wp12 + production-path tests still green; new assertion in capability test or wp12 that artifact exists (via orchestrator-level test if simple).

### WP-C-07 — Old-contract readability + regressions
- [x] Behaviour: decision-evidence v1.0.0 schema file unchanged; historical decision-evidence (without capability fields) still loads (existing DE-06 loader tests green); full worker regression + acceptance-prysm/wp2/wp3/wp6/wp7/wp12 + tsc green.
- [x] Proof: command outputs recorded.

### WP-C-08 — Scope check + single commit
- [x] Behaviour: changed files ⊆ permitted list; defect registry DEF-12 CLOSED; single governed commit + push.

## Verification commands

- [x] `node --test src/evidence/capability-evidence.test.js` — exit 0
- [x] `node --test src/evidence/decision-evidence.test.js src/evidence/decision-evidence-production-regression.test.js` — exit 0
- [x] `node --test src/contracts/validator.test.js` — exit 0
- [x] `npm test` — exit 0
- [x] `node scripts/acceptance-prysm.js`, `acceptance-wp2.js`, `acceptance-wp3.js`, `acceptance-wp6.js`, `acceptance-wp7.js`, `acceptance-wp12.js` — exit 0
- [x] `npx tsc --noEmit` — exit 0
- [x] `git diff --name-only` ⊆ permitted list

## Completion

- [x] All WP-C IDs PASS.
- [x] Regression PASS.
- [x] Scope check PASS.
- [x] Single governed checkpoint commit + push.
- [x] PR remains unmerged until authorized.

## Completion evidence (recorded 2026-08-16)

- capability-evidence.test.js: 14/14 PASS (truth tables, determinism, persistence round-trip, fail-closed)
- decision-evidence.test.js + production-regression: 9/9 PASS (WP-C-03 passthrough + DE-16 with capability schema loaded)
- validator.test.js: PASS with capability-evidence valid+invalid fixtures
- npm test (full worker regression): 729/729 PASS EXIT=0 (was 728 pre-WP-C close; +1 net)
- acceptance-prysm / wp2 / wp3 / wp5 / wp6 / wp10 / wp12: ALL EXIT=0 (evidence: .governance/evidence/wpc-verify2.log)
- tsc --noEmit: EXIT=0
- Scope check: `git diff --name-only` ⊆ permitted list (verified at commit)
- Defect registry: DEF-12 hydration half CLOSED in WP-C (unknown-preserving hydrateSite); consumption half (strict capability gating) lands in WP-D
