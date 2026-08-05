# Prysm WP4 Work Order — State Machine and Lifecycle Persistence

**Document:** WP4-00  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Branch:** `feat/prysm-wp4-state-machine`  
**Base commit:** `b51304b07af8bd9a2694a9bbb1b763bcd84a2153`  
**Status:** AUTHORIZED FOR IMPLEMENTATION

---

## 1. Objective

Create the governed Prysm audit lifecycle state machine, append-only transition history, idempotent transition boundary, resumable source-execution checkpoints and production-ready PostgreSQL persistence boundary.

WP4 must make lifecycle behaviour explicit and testable before the Audit Orchestrator is rebuilt in WP5.

WP4 does **not** integrate the new lifecycle service into `run-audit.js`, provider execution, report rendering, approval routes or publication routes. That integration belongs to later work packages.

The approved client-facing report and every report-facing behaviour remain locked.

---

## 2. Governing Sources

Read and follow, in order:

1. `docs/prysm-governance/01_PRYSM_MASTER_REBUILD_CHARTER.md`
2. `docs/prysm-governance/02_PRYSM_REPORT_IMMUTABILITY_CONTRACT.md`
3. `docs/prysm-governance/03_PRYSM_PIPELINE_CONTRACTS_AND_STATE_MACHINE.md`
4. `docs/prysm-governance/05_PRYSM_ACCEPTANCE_AND_RELEASE_PLAYBOOK.md`
5. `docs/prysm-governance/06_PRYSM_IMPLEMENTATION_BACKLOG.md`
6. `docs/prysm-governance/wp1/PRYSM_REPOSITORY_DISPOSITION_AUDIT.md`
7. `docs/prysm-governance/wp1/PRYSM_WP1_RISK_REGISTER.md`
8. WP2 schemas under `services/worker/src/contracts/`
9. WP3 governed Artifact Store under `services/worker/src/storage/`

The lifecycle states and transition-event fields in the Master Rebuild Charter and Pipeline Contracts document are authoritative.

The repository currently has no production application database. WP4 therefore introduces a PostgreSQL-compatible lifecycle persistence boundary and migration without making any live database call in normal development or CI.

---

## 3. Required Deliverables

### 3.1 Canonical lifecycle states

Create one immutable exported state enum containing exactly these normal states:

```text
CREATED
VALIDATED
COLLECTING
EVIDENCE_STORED
EVIDENCE_LOCKED
SCORED
NARRATIVE_PENDING
NARRATIVE_READY
DRAFT_RENDERED
IN_REVIEW
APPROVED
PUBLISHED
```

And exactly these controlled failure states:

```text
VALIDATION_FAILED
COLLECTION_FAILED
NARRATIVE_FAILED
RENDER_FAILED
APPROVAL_REJECTED
PUBLISH_FAILED
```

Do not add aliases, lowercase duplicates, legacy state names or hidden internal lifecycle states.

`PUBLISHED` is terminal.

### 3.2 Allowed transition map

Implement and export one authoritative allowed-transition map.

Required normal transitions:

```text
CREATED             -> VALIDATED
VALIDATED           -> COLLECTING
COLLECTING          -> EVIDENCE_STORED
EVIDENCE_STORED     -> EVIDENCE_LOCKED
EVIDENCE_LOCKED     -> SCORED
SCORED              -> NARRATIVE_PENDING
NARRATIVE_PENDING   -> NARRATIVE_READY
NARRATIVE_READY     -> DRAFT_RENDERED
DRAFT_RENDERED      -> IN_REVIEW
IN_REVIEW           -> APPROVED
APPROVED            -> PUBLISHED
```

Required controlled-failure transitions:

```text
CREATED             -> VALIDATION_FAILED
COLLECTING          -> COLLECTION_FAILED
NARRATIVE_PENDING   -> NARRATIVE_FAILED
NARRATIVE_READY     -> RENDER_FAILED
IN_REVIEW           -> APPROVAL_REJECTED
APPROVED            -> PUBLISH_FAILED
```

Required controlled recovery transitions:

```text
VALIDATION_FAILED   -> VALIDATED
COLLECTION_FAILED   -> COLLECTING
NARRATIVE_FAILED    -> NARRATIVE_PENDING
RENDER_FAILED       -> NARRATIVE_READY
APPROVAL_REJECTED   -> IN_REVIEW
PUBLISH_FAILED      -> APPROVED
```

Rules:

- every transition not listed above fails;
- no state may skip required intermediate states;
- `PUBLISHED` has no outgoing transition;
- failure recovery returns only to the last safe governed stage;
- a recovery transition requires a non-empty reason and a new execution ID;
- state comparison is case-sensitive;
- adapters, repositories and HTTP routes do not own the transition map.

### 3.3 Lifecycle service

Create one canonical lifecycle service with a boundary equivalent to:

```js
createAudit(input)
getAudit(scope)
getHistory(scope)
transition(command)
```

The service owns validation of state transitions and calls a repository to persist them atomically.

A transition command must include:

- tenant ID;
- client ID;
- audit ID;
- expected current state;
- expected current version;
- next state;
- idempotency key;
- actor;
- reason;
- execution ID;
- code version;
- optional relevant artifact key;
- optional structured metadata.

The service must use an injectable clock and ID generator for deterministic tests.

Only the lifecycle service may call the repository's compare-and-append transition operation.

### 3.4 Current audit projection

Maintain one current-state projection containing at least:

- contract version;
- tenant ID;
- client ID;
- audit ID;
- current state;
- monotonically increasing state version;
- created timestamp;
- updated timestamp;
- last transition ID;
- last execution ID;
- code version.

Every projection returned from a repository must be tenant/client/audit scoped.

No workstation path, provider payload, secret, report HTML or narrative text may enter the lifecycle projection.

### 3.5 Append-only transition event

Every accepted transition must append one immutable event containing at least:

- contract version;
- transition ID;
- tenant ID;
- client ID;
- audit ID;
- sequence number;
- prior state;
- next state;
- timestamp;
- actor;
- reason;
- execution ID;
- code version;
- idempotency key;
- optional relevant artifact key;
- optional structured metadata.

Rules:

- sequence begins at 1 and increments by exactly 1;
- prior state must match the projection immediately before the event;
- next state must match the projection immediately after the event;
- transition events are never updated or deleted by application code;
- history is returned in ascending sequence order;
- the projection can be rebuilt deterministically from the event stream;
- creation of the audit records `CREATED` as the initial projection and initial append-only event;
- failed or rejected transition attempts append nothing.

### 3.6 Idempotency

Idempotency is mandatory for audit creation and transition commands.

Required behaviour:

- same tenant plus same creation idempotency key plus identical canonical creation input returns the existing audit without creating another event;
- same transition idempotency key plus identical canonical transition command returns the original transition result;
- same idempotency key with materially different canonical input fails with a structured idempotency-conflict error;
- retries after an uncertain client response do not append a duplicate event;
- idempotency keys are tenant scoped;
- canonical hashes exclude volatile timestamps generated by the service;
- no provider, model or report work is performed by WP4.

### 3.7 Optimistic concurrency

Every transition must use both expected state and expected state version.

The repository must perform one atomic compare-and-append operation that:

1. verifies tenant, client and audit identity;
2. verifies expected state;
3. verifies expected version;
4. inserts the append-only event;
5. updates the current projection;
6. commits both or neither.

Concurrent commands based on the same state version must produce exactly one accepted transition. Losing commands fail with a structured concurrency-conflict error and append nothing.

Do not use last-write-wins lifecycle persistence.

### 3.8 Structured failures

Provide structured error classes or stable error codes for at least:

- invalid lifecycle state;
- invalid transition;
- audit not found;
- audit already exists;
- invalid identity scope;
- idempotency conflict;
- state mismatch;
- state-version conflict;
- append failure;
- projection update failure;
- persistence transaction failure;
- source checkpoint conflict;
- malformed source plan.

Do not silently coerce, downgrade or ignore lifecycle failures.

### 3.9 Repository interface

Create one repository contract with operations equivalent to:

```js
createAudit(record, creationEvent, idempotencyRecord)
getAudit(scope)
getHistory(scope)
findCreationByIdempotencyKey(tenantId, key)
findTransitionByIdempotencyKey(scope, key)
compareAndAppendTransition(input)
putSourcePlan(input)
getSourcePlan(scope, planHash)
updateSourceCheckpoint(input)
```

Provide:

1. memory implementation for unit and contract tests;
2. PostgreSQL-compatible implementation using an injected `pg.Pool` or `pg.Client` compatible object;
3. migration SQL executed in CI against an in-memory PostgreSQL emulator such as `pg-mem`.

The production repository implementation must use real SQL and real transaction boundaries. Static SQL-string inspection alone is not acceptance proof.

Normal CI must make zero live Railway or external database calls.

### 3.10 PostgreSQL persistence

Add an idempotent migration that creates lifecycle-owned tables equivalent to:

```text
audit_lifecycle
audit_lifecycle_events
audit_lifecycle_idempotency
audit_source_plans
audit_source_checkpoints
```

Required database constraints:

- tenant/client/audit identity is preserved on every table;
- audit identity is unique within tenant scope;
- current state and version are not nullable;
- event sequence is unique per audit;
- transition ID is globally unique;
- idempotency key is unique per tenant and command scope;
- source key is unique per audit and plan hash;
- foreign keys prevent orphan events and checkpoints;
- application event rows have no update or delete path;
- JSON metadata defaults to an empty object where used;
- timestamps are stored with timezone;
- transaction rollback leaves neither projection nor event partially written.

The migration must be repeatable or safely detect that it has already run.

Do not connect WP4 to the existing n8n PostgreSQL service. The production database resource and deployment wiring are outside this work package.

### 3.11 Resumable source execution checkpoints

WP4 must define and persist source-plan checkpoints without executing sources.

A source plan contains:

- contract version;
- tenant/client/audit identity;
- deterministic plan hash;
- plan version;
- ordered unique source keys;
- creation timestamp;
- code version.

Each source checkpoint contains:

- source key;
- checkpoint state: `PENDING`, `IN_PROGRESS` or `COMPLETED`;
- attempt count;
- last execution ID;
- optional universal Source Result status;
- optional source-result artifact key;
- updated timestamp.

Rules:

- source keys are unique within a plan;
- a completed checkpoint is not returned as pending during normal resume;
- `PENDING` and interrupted `IN_PROGRESS` checkpoints are returned for resume;
- force replay may include completed checkpoints but must be explicit;
- a different plan hash cannot mutate checkpoints belonging to the prior plan;
- source result statuses remain the seven WP2 source-status values and are not replaced by checkpoint states;
- checkpoint persistence does not call providers, calculate scores or assemble evidence;
- plan creation and checkpoint updates are tenant scoped and concurrency protected.

Provide a deterministic helper equivalent to:

```js
getResumeSourceKeys(plan, checkpoints, { force: false })
```

### 3.12 Legacy containment

Existing lifecycle behaviour in `review-gate.js`, `report-store.js`, `run-audit.js` and HTTP routes remains in place for backward compatibility during WP4.

WP4 must not partially wire the new lifecycle service into those paths.

Add a narrow automated guard proving that:

- no source adapter imports the lifecycle service;
- no source adapter changes audit state;
- the new PostgreSQL lifecycle repository is not instantiated by adapters;
- WP4 does not change report approval or publication behaviour.

WP5 will integrate the state machine into the new Audit Orchestrator.

---

## 4. Required Schemas and Fixtures

Add versioned Draft 2020-12 schemas for:

1. audit lifecycle projection;
2. lifecycle transition event;
3. source execution plan;
4. source execution checkpoint.

Use stable versioned `$id` values and the WP2 Draft 2020-12 validator.

Provide valid, invalid and edge fixtures proving at least:

- full normal path;
- each controlled failure transition;
- each controlled recovery transition;
- invalid skipped transition;
- terminal `PUBLISHED` transition rejection;
- duplicate transition idempotency;
- conflicting idempotency payload;
- stale state version;
- cross-tenant access rejection;
- interrupted source checkpoint resume;
- force replay;
- plan-hash mismatch.

Unknown fields must fail schema validation.

---

## 5. Required Tests

### 5.1 Shared repository contract suite

Run the same behavioural repository suite against:

- memory repository;
- PostgreSQL repository using an in-memory PostgreSQL engine that executes the real migration and SQL.

The shared suite must prove:

- audit creation creates one `CREATED` event;
- duplicate identical creation is idempotent;
- conflicting creation idempotency fails;
- the complete normal path reaches `PUBLISHED`;
- every event sequence is contiguous;
- projection rebuild from history equals stored projection;
- each controlled failure transition works only from its allowed state;
- each recovery transition returns only to its required safe state;
- invalid transitions append nothing;
- `PUBLISHED` rejects every further transition;
- stale expected state fails;
- stale expected version fails;
- two concurrent transitions produce one winner and one conflict;
- duplicate identical transition is idempotent;
- conflicting transition idempotency fails;
- append failure rolls back projection update;
- projection update failure rolls back event append;
- tenant isolation applies to projection, history and idempotency;
- database transaction failure propagates;
- history ordering is deterministic;
- relevant artifact key is preserved without accessing object storage.

### 5.2 Source resume suite

Prove:

- deterministic plan hash;
- duplicate source keys are rejected;
- new plan starts every source at `PENDING`;
- `IN_PROGRESS` increments attempt count atomically;
- `COMPLETED` records the universal source status and optional artifact key;
- normal resume returns only `PENDING` and interrupted `IN_PROGRESS` sources;
- force resume returns every source;
- plan-hash mismatch fails;
- concurrent checkpoint updates do not lose attempts;
- tenant isolation applies;
- no provider or artifact call occurs.

### 5.3 Migration suite

Execute the migration against the in-memory PostgreSQL engine and prove:

- first migration succeeds;
- repeat migration is safe;
- all required tables and constraints exist;
- duplicate event sequence fails;
- duplicate idempotency key fails;
- orphan event insertion fails;
- rollback preserves atomicity;
- timezone timestamps round-trip correctly.

### 5.4 Regression and lock suites

All previous gates remain mandatory:

```text
npm run check:template
npm test
npm run test:schemas
npm run test:artifacts
npm run acceptance:wp2
npm run acceptance:wp3
```

The report template and golden-master boundary must remain unchanged.

---

## 6. Commands

Add and enforce:

```text
npm run test:lifecycle
npm run acceptance:wp4
```

`test:lifecycle` must run lifecycle unit tests, both repository contract suites, migration tests and source-resume tests.

`acceptance:wp4` must exit non-zero on any failed requirement.

GitHub CI must run both commands after the existing WP3 gates.

---

## 7. Permitted Paths

Implementation changes are limited to:

```text
services/worker/src/lifecycle/**
services/worker/src/contracts/**                 # WP4 lifecycle schemas and validator registration only
services/worker/migrations/**                    # WP4 lifecycle migration only
services/worker/test-fixtures/lifecycle/**
services/worker/scripts/acceptance-wp4.js
services/worker/package.json
services/worker/package-lock.json
.github/workflows/worker-ci.yml
docs/prysm-governance/wp4/**
```

A narrow test-only import guard may read existing adapter, audit, storage and report files without changing them.

Any other changed path requires explicit Principal Auditor approval before modification.

---

## 8. Prohibited Changes

WP4 must not change:

- `run-audit.js` orchestration;
- `review-gate.js` behaviour;
- existing `report-store.js` lifecycle behaviour;
- HTTP routes or web application behaviour;
- provider request logic;
- provider retry or timeout policy;
- source adapters or source statuses;
- Artifact Store behaviour;
- canonical evidence assembly;
- scoring rules;
- finding rules;
- n8n workflows;
- LLM models or prompts;
- report HTML;
- report CSS;
- report assets;
- report page structure;
- renderer output;
- report viewer behaviour;
- approval or publication behaviour;
- deployment configuration;
- Railway services;
- the existing n8n database.

Do not make live provider, LLM, Railway, S3 or database calls during normal development or CI.

Do not add a general-purpose ORM.

Do not implement WP5 Audit Orchestrator behaviour in WP4.

---

## 9. Acceptance Gate

WP4 passes only when all of the following are true:

- the exact governed state enum exists;
- one allowed-transition map exists;
- normal, failure and recovery paths match this work order;
- every invalid transition fails without mutation;
- lifecycle events are append-only and contiguous;
- current projections rebuild deterministically from history;
- creation and transition idempotency behave correctly;
- optimistic concurrency produces one winner;
- memory and PostgreSQL repositories pass the same contract suite;
- the real migration and SQL execute in CI;
- transaction rollback prevents partial lifecycle writes;
- tenant/client/audit scoping is enforced;
- resumable source checkpoints behave predictably;
- source plan force replay is explicit;
- no adapter owns lifecycle state;
- no existing production path is partially migrated;
- `npm run test:lifecycle` passes;
- `npm run acceptance:wp4` passes;
- WP2 schema gates pass;
- WP3 Artifact Store gates pass;
- the full existing regression suite passes;
- the report template check passes;
- GitHub CI executes and passes every required command;
- final diff remains inside WP4 scope;
- Principal Auditor approval is recorded.

Do not merge WP4 until this gate passes.

---

## 10. Required Completion Report

Report:

- branch;
- full commit SHA;
- changed-file list and count;
- canonical lifecycle service path;
- state enum path;
- transition map path;
- memory repository path;
- PostgreSQL repository path;
- migration path;
- lifecycle schemas and fixtures;
- normal-path test total;
- controlled-failure and recovery test totals;
- idempotency test totals;
- concurrency test totals;
- repository contract totals by implementation;
- source resume test totals;
- migration test totals;
- WP4 acceptance total;
- WP3 Artifact Store total;
- WP2 schema total;
- full regression total;
- template-lock result;
- GitHub CI result;
- live-call count;
- git status;
- known limitations;
- confidence.

Confidence must be at least 97% before requesting merge.
