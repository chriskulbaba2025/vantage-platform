# Prysm Recommended First Implementation PR

**Document:** WP1-06  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Status:** RECOMMENDATION ONLY — Do not implement until WP1 is approved

---

## Recommendation

**PR Title:** Prysm WP2: Schemas and fixtures — Audit Request through Report View Model

**Phase:** Work Package 2 — Schemas and Fixtures  
**Depends on:** WP1 approval (this audit)  
**Blocks:** WP3 (Artifact Store), WP4 (State Machine), WP5 (Orchestrator)

---

## Rationale

WP1 identifies the following as the most impactful structural deficiencies:

1. **No ReportViewModel** — all 14 section renderers read raw provider evidence directly (risk R-WP1-003, RPN=60)
2. **No universal adapter contract enforcement** — each adapter returns a different shape (risk R-WP1-002, RPN=60)
3. **No artifact contract** — five parallel write paths with no unified interface
4. **No state machine contract** — only 3 of 12+ charter lifecycle states implemented
5. **No narrative contract** — n8n receives ad-hoc compacted JSON, not a versioned schema

WP2 (Schemas and Fixtures) addresses all five by defining the **contracts first** — before any implementation changes. This is the charter-prescribed sequence (01 §9 Phase 1) and the correct architectural approach: define the interfaces, then implement against them.

---

## Scope

### Schemas to Create

1. **Audit Request Schema** (`schemas/audit-request.schema.json`)
   - Based on existing `validateInput()` in `run-audit.js`
   - Formalize: `targetUrl`, `businessName`, `location`, `language`, `competitors[]`, `primaryGoal`, `ga4{propertyId}`, `gsc{siteUrl}`
   - Add: `idempotencyKey`, `auditId`, `tenantId`, `clientId`
   - Version: `1.0.0`

2. **Source Result Schema** (`schemas/source-result.schema.json`)
   - Based on `buildSourceStatus()` + `buildEvidenceEnvelope()` in `evidence-contracts.js`
   - Formalize the universal adapter return type: `schemaVersion`, `source`, `provider`, `adapterVersion`, `status`, `startedAt`, `completedAt`, `requestId`, `retryCount`, `expectedRecords`, `returnedRecords`, `coverage`, `limitations[]`, `artifact{key,sha256,bytes,contentType}`, `evidence{}`
   - Version: `1.0.0`

3. **Artifact Record Schema** (`schemas/artifact-record.schema.json`)
   - Define: `key`, `sha256`, `bytes`, `contentType`, `tenantId`, `clientId`, `auditId`, `createdAt`, `verified`
   - Match charter artifact key structure: `tenants/{id}/clients/{id}/audits/{id}/...`
   - Version: `1.0.0`

4. **Canonical Evidence Schema** (`schemas/canonical-evidence.schema.json`)
   - Based on existing evidence assembly in `run-audit.js`
   - Formalize: all source status records, normalized page evidence, performance evidence, competitor evidence, backlink evidence, GA4 evidence, GSC evidence, limitations, artifact references, version identifiers
   - Version: `1.0.0`

5. **Finding Schema** (`schemas/finding.schema.json`)
   - Based on existing finding structure in `score-components.js`
   - Formalize 16 required fields: `findingId`, `ruleId`, `ruleVersion`, `dimension`, `module`, `title`, `affectedUrls[]`, `evidence[]`, `confidence`, `businessImpact`, `recommendation`, `implementationEffort`, `verificationMethod`, `scoreBearing`, `rawPriority`, `finalPriority`
   - Version: `1.0.0`

6. **Score Schema** (`schemas/score.schema.json`)
   - Based on existing model output in `vantage-score.js`
   - Formalize: dimension scores, module scores, assessed weight, evidence confidence, bands, eligibility maps, readiness status
   - Version: `1.0.0`

7. **Report Content Schema** (`schemas/report-content.schema.json`)
   - Based on `prepare-payload.js` compaction logic
   - Formalize the bounded payload sent to n8n: scores, finding IDs, deterministic facts, section assignments, limitations, source-status summary, field limits
   - Explicitly exclude: raw provider payloads, HTML, CSS, screenshots, secrets, debug logs
   - Version: `1.0.0`

8. **Narrative Response Schema** (`schemas/narrative-response.schema.json`)
   - Define allowed fields, field limits, prohibited content (HTML, CSS, new URLs, new finding IDs, score values)
   - Version: `1.0.0`

9. **Report View Model Schema** (`schemas/report-view-model.schema.json`)
   - Define the validated view model the renderer accepts
   - Must NOT include raw evidence envelopes
   - Must include all content needed for the 14 report sections
   - Version: `1.0.0`

10. **Report Manifest Schema** (`schemas/report-manifest.schema.json`)
    - Based on existing manifest structure
    - Formalize: `artifactVersion`, `reportVersion`, `runId`, `slug`, `targetUrl`, `startedAt`, `completedAt`, `status`, `scores`, `sources`, `selectedProperties`, `files[]`
    - Version: `1.0.0`

### Fixtures to Create

For each schema, create:

1. **Valid fixture** — a complete, realistic example that passes validation
2. **Invalid fixture** — a deliberately broken example that fails validation with specific error messages
3. **Edge-case fixture** — covers boundary conditions (empty arrays, null optional fields, max-length strings)

Use existing production-shaped data (from `run-audit.test.js` fixtures) as the basis for valid fixtures.

### Schema Test Command

```bash
npm run test:schemas
```

Must validate:
- Every valid fixture passes its schema
- Every invalid fixture fails with expected errors
- Schema versions are consistent
- No schema references undefined types
- All required fields from governance contracts are present

---

## Permitted Changes

- Create `services/worker/src/schemas/` directory
- Create 10 JSON Schema files
- Create `services/worker/test-fixtures/schemas/` directory
- Create valid/invalid/edge fixtures for each schema
- Add `test:schemas` script to `package.json`
- Add schema validation test file(s)
- Update `CLAUDE.md` with WP2 status

## Prohibited Changes

- No production application code changes
- No adapter changes
- No scoring changes
- No finding changes
- No report HTML, CSS, assets, layout, renderer or viewer changes
- No database changes
- No n8n workflow changes
- No feature development
- No dependency upgrades
- No deployment
- No merge

---

## Alignment with Governance Contracts

| Contract | Schema | How Addressed |
|---|---|---|
| 03 §2 Audit Request | Audit Request Schema | Formalizes `validateInput()` |
| 03 §3 Universal Source Result | Source Result Schema | Defines 7-status vocabulary, coverage, artifact contract |
| 03 §4 Artifact Contract | Artifact Record Schema | Defines key structure, SHA-256, bytes, content type |
| 03 §5 Canonical Evidence | Canonical Evidence Schema | Locks evidence shape before scoring |
| 03 §6 Finding Contract | Finding Schema | 16 required fields, evidence reference enforcement |
| 03 §7 Score Contract | Score Schema | Assessed weight, eligibility, deterministic scoring |
| 03 §8 Report Content Package | Report Content Schema | Bounded n8n payload, no raw provider data |
| 03 §9 Narrative Response | Narrative Response Schema | Field limits, prohibited content |
| 03 §10 Report View Model | Report View Model Schema | Protected renderer boundary |
| 02 §5 Protected Renderer Boundary | Report View Model Schema | Renderer accepts only validated view model |

---

## Migration Dependency

WP2 must complete before:
- **WP3 (Artifact Store):** needs Artifact Record schema for `put/get/exists/verify` interface
- **WP4 (State Machine):** needs Audit Request schema for lifecycle transitions
- **WP5 (Orchestrator):** needs Source Result schema for adapter contracts
- **WP6 (Adapter Migration):** needs universal Source Result schema
- **WP7 (Findings/Scores):** needs Finding and Score schemas for determinism tests
- **WP8 (Report Content):** needs Report Content schema
- **WP9 (n8n Narrative):** needs Narrative Response schema
- **WP10 (Locked Renderer):** needs Report View Model schema

---

## Migration Order

WP2 is **first** in the implementation sequence. No other work package can begin until schemas are defined.

---

## Gate

> All schemas compile and fixtures behave correctly.

Pass criteria:
1. All 10 JSON Schemas are valid JSON Schema (draft-2020-12 or draft-07)
2. All valid fixtures validate successfully
3. All invalid fixtures fail with descriptive errors
4. All edge-case fixtures behave correctly
5. Schema versions are consistent (`1.0.0` across all)
6. `npm run test:schemas` exits 0
7. No production code changes in the PR diff
8. No report file changes in the PR diff
