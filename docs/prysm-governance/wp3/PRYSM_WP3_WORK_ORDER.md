# Prysm WP3 Work Order — Artifact Store

**Document:** WP3-00  
**Version:** 1.0.0  
**Date:** 2026-08-04  
**Branch:** `feat/prysm-wp3-artifact-store`  
**Base commit:** `47903a75b3d360b18f900391cec5ee2f9e7d32ac`  
**Status:** AUTHORIZED FOR IMPLEMENTATION

---

## 1. Objective

Replace the current parallel and adapter-owned permanent-write paths with one governed Artifact Store boundary.

WP3 must establish a single byte-preserving persistence contract before lifecycle, orchestration, or adapter migration work begins.

The approved report and all report-facing behaviour remain locked.

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

The WP2 `artifact-record.schema.json` is the authoritative output shape for stored artifact records.

---

## 3. Required Deliverables

### 3.1 Canonical interface

Create one production interface with these operations:

```js
put(input)    // persist exact bytes and return an Artifact Record
get(key)      // return exact bytes as Buffer
exists(key)   // return boolean
verify(record) // read back and verify key, bytes, SHA-256 and scope
```

Use JavaScript and JSDoc contracts consistent with the current worker codebase.

The interface must not expose provider-specific, report-specific, or filesystem-specific behaviour.

### 3.2 Implementations

Provide:

1. memory implementation for unit and contract tests;
2. temporary-filesystem implementation for local integration tests;
3. object-storage implementation for staging and production.

The object-storage implementation must use dependency injection or a mockable client. Normal CI must make zero live cloud calls.

### 3.3 Exact-byte integrity

For every successful `put`:

- accept bytes as `Buffer`, `Uint8Array`, or explicitly encoded string;
- calculate SHA-256 from the exact bytes written;
- record exact byte length;
- read the object back;
- compare the returned bytes byte-for-byte;
- compare the recalculated SHA-256;
- return an Artifact Record only after verification succeeds.

A write that cannot be read back and verified must fail. It must not return an artifact key or synthetic success record.

### 3.4 Immutable object naming

Keys must follow the governed tenant-scoped structure:

```text
tenants/{tenantId}/clients/{clientId}/audits/{auditId}/{category}/{artifactName}
```

Required rules:

- tenant, client and audit scope are mandatory;
- path traversal is rejected;
- absolute paths are rejected;
- empty segments are rejected;
- backslashes are rejected in object keys;
- object names are deterministic from supplied scope and artifact identity;
- an existing key with identical bytes may return the verified existing record;
- an existing key with different bytes must fail as an immutable-write conflict;
- no timestamp-only or random-only naming that prevents deterministic replay;
- no machine-specific path may enter an Artifact Record.

### 3.5 Artifact Record validation

Every successful `put` result must validate against:

```text
services/worker/src/contracts/artifact-record.schema.json
```

Unknown fields must fail validation.

### 3.6 Failure propagation

The store must surface structured failures for at least:

- invalid input;
- invalid scope;
- path traversal;
- write failure;
- read-back failure;
- byte mismatch;
- SHA mismatch;
- immutable-write conflict;
- object not found;
- provider/client failure.

Do not silently downgrade storage failures. Do not synthesize an artifact reference.

### 3.7 Remove adapter-owned permanent writes

Remove or redirect permanent writes currently owned by evidence adapters and evidence utilities.

The result must prove:

- adapters return raw bytes and normalized evidence to their caller;
- adapters do not decide permanent artifact keys;
- adapters do not write permanent files directly;
- adapters do not instantiate the production object store;
- temporary provider execution files may exist only when required for execution and must not be represented as durable evidence.

Limit adapter changes to persistence ownership only. Do not perform WP6 universal adapter migration in WP3.

### 3.8 Legacy-store containment

The current `report-store.js`, `artifact-store.js`, and `s3-artifact-store.js` may be wrapped, migrated, or deprecated as needed, but WP3 must leave one authoritative Artifact Store interface for new governed code.

Do not delete legacy behaviour still required by existing production tests unless its callers are migrated and all tests prove equivalent behaviour.

---

## 4. Required Tests

### 4.1 Contract suite

The same behavioural suite must run against memory, temporary-filesystem, and mocked object-storage implementations.

It must prove:

- exact bytes survive round-trip;
- binary data survives round-trip;
- UTF-8 data survives round-trip;
- SHA-256 is calculated from stored bytes;
- byte length is exact;
- Artifact Record schema validation passes;
- `exists` is correct before and after writes;
- `get` returns a `Buffer`;
- `verify` succeeds only for matching bytes and metadata;
- identical repeat writes are idempotent;
- different bytes at the same key are rejected;
- tenant isolation is enforced;
- traversal and malformed keys are rejected;
- failed writes return no record;
- failed read-back verification returns no record;
- storage-client errors propagate;
- no live cloud call occurs.

### 4.2 Adapter-write guard

Add an automated guard that fails when governed adapter source paths contain unauthorized permanent-write calls or instantiate a permanent store directly.

The guard must be narrow enough not to reject legitimate temporary execution files or test fixtures.

### 4.3 Regression suite

All pre-existing tests must continue to pass.

The report template hash and approved report files must remain unchanged.

---

## 5. Commands

Add and enforce:

```text
npm run test:artifacts
npm run acceptance:wp3
```

GitHub CI must execute both commands after the existing WP2 gates.

`acceptance:wp3` must exit non-zero on any failed gate.

---

## 6. Permitted Paths

Implementation changes are limited to:

```text
services/worker/src/storage/**
services/worker/src/contracts/**          # only integration needed to validate Artifact Records
services/worker/src/adapters/**           # persistence ownership removal only
services/worker/src/evidence/**           # persistence ownership removal only
services/worker/scripts/acceptance-wp3.js
services/worker/test-fixtures/artifacts/**
services/worker/package.json
services/worker/package-lock.json
.github/workflows/worker-ci.yml
docs/prysm-governance/wp3/**
```

Any other path requires explicit Principal Auditor approval before modification.

---

## 7. Prohibited Changes

WP3 must not change:

- report HTML;
- report CSS;
- report assets;
- report page structure;
- renderer output;
- report viewer behaviour;
- scoring rules;
- finding rules;
- source-status semantics;
- business recommendations;
- n8n workflows;
- LLM models or prompts;
- database implementation;
- lifecycle state machine;
- Audit Orchestrator implementation;
- web application behaviour;
- provider request logic;
- retry or timeout policy;
- report approval or publication behaviour.

Do not make live provider, LLM, Railway, S3, or other cloud calls during normal development or CI.

---

## 8. Acceptance Gate

WP3 passes only when all of the following are true:

- one authoritative Artifact Store interface exists;
- all three implementations pass the same contract suite;
- every returned record validates against the WP2 Artifact Record schema;
- exact bytes and SHA-256 survive write and read-back;
- immutable-write conflicts fail;
- tenant scoping and traversal protection pass;
- storage failures propagate without synthetic references;
- governed adapters no longer own permanent writes;
- `npm run test:artifacts` passes;
- `npm run acceptance:wp3` passes;
- all WP2 schema gates pass;
- the full existing test suite passes;
- the report template check passes;
- GitHub CI runs and passes every required command;
- final diff remains inside WP3 scope;
- Principal Auditor approval is recorded.

Do not merge WP3 until this gate passes.

---

## 9. Required Completion Report

Report:

- branch;
- full commit SHA;
- changed-file list and count;
- canonical interface path;
- implementation paths;
- legacy-store disposition;
- adapter-owned writes removed or redirected;
- contract test totals;
- WP3 acceptance totals;
- WP2 schema test totals;
- full regression totals;
- template-lock result;
- GitHub CI result;
- live-call count;
- git status;
- known limitations;
- confidence.

Confidence must be at least 97% before requesting merge.