# Prysm WP4 Work Order — State Machine and Lifecycle

**Document:** WP4-00  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Branch:** `feat/prysm-wp4-state-machine`  
**Base:** WP3 Artifact Store (`feat/prysm-wp3-artifact-store`)  
**Status:** AUTHORIZED FOR IMPLEMENTATION

---

## 1. Objective

Establish the governed lifecycle and state-machine boundary before any orchestration work begins.  WP4 must deliver one canonical state machine with append-only event recording, idempotent creation and transitions, optimistic concurrency, and a database-backed repository.

The existing 3-state `review-gate.js` lifecycle and `report-store.js` lifecycle methods are not modified by WP4.

---

## 2. Governing Sources

Read and follow, in order:

1. `docs/prysm-governance/01_PRYSM_MASTER_REBUILD_CHARTER.md`
2. `docs/prysm-governance/03_PRYSM_PIPELINE_CONTRACTS_AND_STATE_MACHINE.md`
3. `docs/prysm-governance/05_PRYSM_ACCEPTANCE_AND_RELEASE_PLAYBOOK.md`
4. `docs/prysm-governance/06_PRYSM_IMPLEMENTATION_BACKLOG.md`
5. `docs/prysm-governance/07_PRYSM_CLAUDE_CODE_WORK_ORDER.md`

---

## 3. Required Deliverables

### 3.1 State enum

Define the exact normal and controlled-failure state enum per §11 of the Pipeline Contracts:

Normal path:
```
CREATED → VALIDATED → COLLECTING → EVIDENCE_STORED → EVIDENCE_LOCKED
→ SCORED → NARRATIVE_PENDING → NARRATIVE_READY → DRAFT_RENDERED
→ IN_REVIEW → APPROVED → PUBLISHED
```

Controlled failures:
```
VALIDATION_FAILED, COLLECTION_FAILED, NARRATIVE_FAILED,
RENDER_FAILED, APPROVAL_REJECTED, PUBLISH_FAILED
```

Use a frozen object with stable string values.

### 3.2 Transition and recovery map

Define the authoritative allowed-transition map.  It must include:

- every valid normal-state → normal-state transition;
- every valid normal-state → failure-state transition;
- recovery transitions from controlled failure states back to the appropriate normal state;
- no invalid transitions.

Every transition must be recorded as an append-only lifecycle event.

### 3.3 Lifecycle service

Create a `LifecycleService` with these methods:

```js
create({ auditId, tenantId, clientId, idempotencyKey })  → LifecycleState
transition({ auditId, fromState, toState, actor, reason, executionId, artifactKey, expectedVersion })  → LifecycleState
currentState(auditId)   → LifecycleState
history(auditId)        → LifecycleEvent[]
```

Rules:
- `create` is idempotent by `idempotencyKey`;
- `transition` enforces `expectedState` and `expectedVersion` optimistic concurrency;
- every event is append-only with guaranteed ordering;
- `currentState` is a deterministic projection of the event log.

### 3.4 Lifecycle events

Every event records:

- `eventId` — UUID v4;
- `auditId` — owning audit;
- `tenantId` — owning tenant;
- `clientId` — owning client;
- `sequence` — monotonically increasing within the audit;
- `priorState` — state before transition;
- `nextState` — state after transition;
- `timestamp` — ISO-8601;
- `actor` — "system" or Principal Auditor identity;
- `reason` — human-readable reason string;
- `executionId` — optional execution identifier;
- `codeVersion` — Prysm code version identifier;
- `artifactKey` — optional relevant artifact key.

### 3.5 Structured lifecycle errors

Must surface at least:

- `LifecycleError` (base);
- `AuditNotFoundError`;
- `DuplicateAuditError` (same idempotency key, different auditId);
- `InvalidTransitionError`;
- `ConcurrencyConflictError` (expectedState or expectedVersion mismatch);
- `InvalidLifecycleInputError`.

### 3.6 Memory repository

Create `MemoryLifecycleRepository` implementing the full repository contract backed by a Map.

### 3.7 PostgreSQL repository and migration

Create:

- `PostgresLifecycleRepository` using real SQL and transactions;
- `migrations/001_lifecycle.sql` — idempotent, rerunnable, uses IF NOT EXISTS;
- Integration tests using `pg-mem` (in-memory PostgreSQL engine) with the real migration applied and real SQL executed — no fully mocked query responses.

The migration creates:
- `prysm.lifecycle_events` table with all columns;
- indexes on audit_id, sequence, tenant_id;
- the `prysm` schema itself.

### 3.8 Lifecycle schemas

Create Draft 2020-12 JSON Schemas:

- `lifecycle-state.schema.json` — current-state shape
- `lifecycle-event.schema.json` — single event shape
- Valid and invalid fixtures

### 3.9 Resumable source plans and checkpoints

Provide:

- `buildSourcePlan(auditRequest)` — returns the ordered list of sources to execute;
- `SourceCheckpoint` records — which sources are done, which remain;
- Deterministic cache keys per source per audit.

### 3.10 Shared repository contract tests

The same behavioural suite must run against memory and PostgreSQL (pg-mem) repositories.

---

## 4. Required Tests

### 4.1 Contract suite

Run against both implementations.  Prove:

- audit creation is idempotent;
- duplicate creation with different idempotencyKey fails;
- every valid normal transition succeeds;
- every valid normal→failure transition succeeds;
- every valid recovery transition succeeds;
- every invalid transition throws InvalidTransitionError;
- transition with wrong expectedState throws ConcurrencyConflictError;
- transition with wrong expectedVersion throws ConcurrencyConflictError;
- currentState returns correct projection;
- history returns events in sequence order;
- events are immutable after write;
- tenant isolation is enforced.

### 4.2 Migration tests

Prove:
- migration is idempotent (run twice, no error);
- all columns, indexes and constraints exist;
- real INSERT, SELECT, UPDATE operations work.

### 4.3 Source plan tests

Prove:
- source plan is deterministic for same input;
- checkpoints advance correctly;
- resuming from checkpoint skips completed sources.

---

## 5. Commands

Add and enforce:

```text
npm run test:lifecycle
npm run acceptance:wp4
```

GitHub CI must execute both after the existing WP3 gates.

---

## 6. Permitted Paths

```text
services/worker/src/lifecycle/**
services/worker/src/contracts/lifecycle-state.schema.json
services/worker/src/contracts/lifecycle-event.schema.json
services/worker/test-fixtures/contracts/valid/lifecycle-*.json
services/worker/test-fixtures/contracts/invalid/lifecycle-*.json
services/worker/test-fixtures/lifecycle/**
services/worker/scripts/acceptance-wp4.js
services/worker/migrations/**
services/worker/package.json
services/worker/package-lock.json
.github/workflows/worker-ci.yml
docs/prysm-governance/wp4/**
```

---

## 7. Prohibited Changes

- Do not modify run-audit.js.
- Do not modify review-gate.js.
- Do not modify report-store lifecycle behaviour.
- Do not modify providers, adapters, source statuses or Artifact Store.
- Do not modify evidence assembly, scoring, findings or n8n.
- Do not modify report HTML, CSS, assets, page structure, renderer or viewer.
- Do not modify approval, publication, HTTP routes, deployment or Railway.
- Do not connect to the existing n8n PostgreSQL database.
- Do not make live provider, LLM, S3, Railway or database calls.
- Do not implement WP5 Audit Orchestrator behaviour.

---

## 8. Acceptance Gate

All must pass:

- state enum matches §11 of pipeline contracts;
- every valid transition succeeds;
- every invalid transition fails;
- idempotency and optimistic concurrency work;
- both repository implementations pass the same contract suite;
- migration is idempotent and pg-mem tests pass;
- all schemas compile and fixtures validate;
- `npm run test:lifecycle` passes;
- `npm run acceptance:wp4` passes;
- all WP2 and WP3 gates pass;
- full existing test suite passes;
- template check passes;
- CI runs every required command;
- final diff remains inside WP4 scope.

---

## 9. Required Completion Report

Report:

- branch;
- full commit SHA;
- changed-file list and count;
- canonical state machine path;
- lifecycle service path;
- repository implementation paths;
- migration path;
- schema and fixture paths;
- contract test totals per implementation;
- WP4 acceptance totals;
- WP2 + WP3 gate totals;
- full regression totals;
- template-lock result;
- GitHub CI result;
- pg-mem verification result;
- live-call count;
- git status;
- known limitations;
- confidence.

Confidence must be at least 97% before requesting merge.
