# Prysm Work Package 2 — Schemas and Fixtures Work Order

**Document:** WP2-00  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Status:** IN PROGRESS  
**Branch:** `feat/prysm-wp2-schemas-fixtures`  
**Base merge commit:** `e41a82080811c89b34e325c0c2238576747b32c0`  
**Work Package 1:** Approved and merged through PR #31

---

## 1. Measurable Goal

Define, compile and test the complete versioned contract chain required by the Prysm governed rebuild before any Artifact Store, state-machine, adapter or renderer migration begins.

```text
AuditRequest
→ SourceExecutionResult[]
→ CanonicalEvidence
→ FindingSet
→ ScoreSet
→ ReportContentPackage
→ NarrativeResponse
→ ReportViewModel
→ ReportArtifactManifest
```

---

## 2. Required Schemas

Create exactly these ten versioned JSON Schemas:

1. Audit Request
2. Source Result
3. Artifact Record
4. Canonical Evidence
5. Finding
6. Score
7. Report Content
8. Narrative Response
9. Report View Model
10. Report Manifest

Each schema must:

- declare its schema and contract version;
- reject unknown fields unless explicitly permitted;
- enforce required fields, formats, enums, bounds and nested contracts;
- preserve deterministic identifiers and version fields;
- prohibit secrets, raw provider payloads, HTML and CSS where the governing contract forbids them;
- remain independent of workstation paths and live services.

---

## 3. Required Fixtures

For every schema, add:

- at least one production-shaped valid fixture;
- at least one invalid fixture that proves a mandatory rejection;
- edge fixtures where status-dependent or threshold-dependent rules exist.

Fixtures must be static, deterministic and safe for CI. They must contain no real credentials, access tokens, personal analytics records or live client secrets.

---

## 4. Required Validation Layer

Use JSON Schema Draft 2020-12 with one centrally configured validator. Schema compilation must occur before fixture validation. Cross-schema references must resolve from stable versioned `$id` values.

Add commands:

```text
npm run test:schemas
npm run acceptance:wp2
```

`acceptance:wp2` must exit non-zero when:

- any schema fails to compile;
- any valid fixture fails validation;
- any invalid fixture passes validation;
- any required schema or fixture is missing;
- any schema reference cannot resolve.

Normal unit and CI execution must make zero provider calls and zero LLM calls.

---

## 5. Permitted Paths

- `services/worker/src/contracts/**`
- `services/worker/test-fixtures/contracts/**`
- `services/worker/scripts/acceptance-wp2.*`
- `services/worker/package.json`
- `services/worker/package-lock.json`
- `.github/workflows/worker-ci.yml` only to add the WP2 acceptance command
- `docs/prysm-governance/wp2/**`

---

## 6. Prohibited Changes

- Do not alter approved report HTML, CSS, assets, pages, layout, typography, navigation, header, footer, CTA, print behaviour or viewer behaviour.
- Do not alter scoring rules or score values.
- Do not alter finding generation logic.
- Do not alter adapters, provider clients or retry behaviour.
- Do not alter n8n workflows or model selection.
- Do not implement the Artifact Store, state machine, database or orchestrator in this work package.
- Do not make live provider or LLM calls.
- Do not hardcode workstation paths.
- Do not commit generated runtime artifacts.
- Do not merge this branch until the WP2 gate passes and Principal Auditor approval is recorded.

---

## 7. Required Process

1. Read the authoritative governance documents under `docs/prysm-governance/`.
2. Inspect current runtime shapes in intake, evidence contracts, findings, scores, n8n payload preparation and report models.
3. Record shape conflicts without changing production implementation.
4. Implement only the schemas, fixtures, validator and WP2 acceptance harness.
5. Run schema tests.
6. Run the full existing suite.
7. Run `npm run acceptance:wp2`.
8. Review the final diff for scope violations.
9. Confirm report files are untouched.
10. Continue correcting until confidence is at least 97%.

---

## 8. Gate

Work Package 2 passes only when:

- all ten schemas compile;
- every valid fixture passes;
- every invalid fixture fails for the intended reason;
- all schema references resolve;
- schema tests and the full existing test suite pass;
- CI runs the WP2 acceptance command;
- no report, scoring, adapter, n8n or production-lifecycle files change;
- no generated artifacts are committed.

Work Package 3 remains blocked until this gate is approved.