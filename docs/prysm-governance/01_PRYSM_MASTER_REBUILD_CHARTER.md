# Prysm Master Rebuild Charter

**Document type:** Authoritative architecture and build charter  
**Version:** 1.0.0  
**Status:** Proposed

---

# 1. Product objective

Prysm is an evidence-grounded website decision system.

It must show:

1. what is wrong;
2. why it matters;
3. what should be fixed first;
4. what evidence supports each conclusion;
5. what could not be assessed;
6. how confident the system is.

It must not turn missing or failed evidence into a business failure.

---

# 2. Current problem

The recurring production failures are caused by weak boundaries rather than Railway itself.

Current symptoms include:

- collection, normalization and persistence mixed inside adapters;
- early-return paths behaving differently from success paths;
- local filesystem paths treated as durable evidence references;
- machine-specific acceptance scripts;
- passing unit tests without full production-path proof;
- provider-specific data leaking into later layers;
- n8n receiving payloads before the contract is frozen;
- fixes validated individually rather than as a complete lifecycle.

The result is:

```text
patch
→ test
→ deploy
→ discover another untested branch
```

The rebuild replaces that with:

```text
contract
→ implementation
→ automated state proof
→ staging proof
→ controlled production proof
```

---

# 3. Scope

## 3.1 Rebuild

- audit orchestration;
- adapter execution boundary;
- artifact persistence;
- audit lifecycle;
- canonical evidence assembly;
- Railway-to-n8n contracts;
- LLM routing and cost control;
- acceptance harness;
- release gates.

## 3.2 Preserve where contract-compliant

- DataForSEO On-Page client;
- DataForSEO SERP client;
- PageSpeed adapter;
- Lighthouse fallback;
- backlink adapter;
- GA4 and GSC routing;
- competitor qualification;
- internal-link rules;
- scoring rules;
- finding rules;
- report content mappings;
- report renderer;
- report viewer.

## 3.3 Lock completely

- current approved report design;
- current report pages;
- current HTML structure;
- current CSS and assets;
- current page order;
- current headers, footers and CTA;
- current client-facing presentation.

## 3.4 Retire

- Railway local disk as permanent storage;
- synthetic artifact references for completed production states;
- machine-specific test paths;
- generated artifacts committed to Git;
- live provider or LLM calls in normal CI;
- unbounded retries;
- LLM-controlled scoring or HTML;
- manual SSH inspection as an acceptance requirement.

---

# 4. Architecture ownership

## 4.1 Web application owns

- client and audit intake;
- validation messages;
- analytics-property selection;
- audit status display;
- report review interface;
- approved report viewer.

It does not own provider logic, scores, findings or report HTML generation.

## 4.2 Railway worker owns

- request validation;
- idempotency;
- audit lifecycle;
- source plan;
- provider execution;
- retries and timeouts;
- source statuses;
- artifact writes;
- canonical evidence;
- module gates;
- deterministic findings;
- deterministic scoring;
- n8n request;
- n8n response validation;
- renderer invocation;
- approval preconditions.

## 4.3 n8n owns

- one bounded report-language workflow;
- one approved model call by default;
- one repair call only after deterministic validation failure;
- returning structured narrative fields.

It does not own evidence, findings, scores, HTML, CSS, pagination, approval or permanent storage.

## 4.4 Database owns

- audit identity;
- tenant/client identity;
- lifecycle state;
- source-status summary;
- version identifiers;
- artifact keys;
- score summary;
- cost summary;
- human approval records;
- execution history.

## 4.5 Object storage owns immutable copies of

- raw provider responses;
- normalized source results;
- canonical evidence;
- findings;
- scores;
- report-content package;
- n8n narrative response;
- draft report pages;
- approved report pages;
- artifact manifests.

---

# 5. Product invariants

## 5.1 Evidence invariant

No client-facing finding exists without at least one evidence reference.

## 5.2 Missing-data invariant

`FAILED`, `PARTIAL`, `BLOCKED`, `UNAVAILABLE`, `NOT_CONNECTED` and `NOT_APPLICABLE` cannot create an automatic score of zero.

## 5.3 Determinism invariant

Identical canonical evidence plus identical rule versions produces identical findings and scores.

## 5.4 Storage invariant

A completed source result with an artifact reference points to an existing object with matching bytes and SHA-256.

## 5.5 Report invariant

A pipeline-only change cannot alter the report golden master.

## 5.6 Approval invariant

No draft or partial report is client-accessible.

## 5.7 Cost invariant

No live LLM call occurs without an explicit model, token cap, retry cap and budget.

---

# 6. Technical direction

## 6.1 Central orchestrator

Create one `AuditOrchestrator` responsible for state transitions and source execution.

Adapters do not control audit state.

## 6.2 Central artifact store

Create one interface:

```ts
interface ArtifactStore {
  put(input: PutArtifactInput): Promise<ArtifactRecord>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  verify(record: ArtifactRecord): Promise<boolean>;
}
```

Implementations:

- memory for unit tests;
- temporary filesystem for local integration tests;
- object storage for staging and production.

Adapters return provider bytes and normalized evidence. The orchestrator persists them.

## 6.3 Canonical source envelope

Every adapter returns one source contract regardless of provider.

## 6.4 Canonical evidence lock

All source envelopes are assembled and locked before findings or scoring.

## 6.5 Locked renderer

The renderer accepts only a validated report view model.

It never reads raw provider payloads.

---

# 7. Lifecycle

```text
CREATED
→ VALIDATED
→ COLLECTING
→ EVIDENCE_STORED
→ EVIDENCE_LOCKED
→ SCORED
→ NARRATIVE_PENDING
→ NARRATIVE_READY
→ DRAFT_RENDERED
→ IN_REVIEW
→ APPROVED
→ PUBLISHED
```

Controlled failure states:

```text
VALIDATION_FAILED
COLLECTION_FAILED
NARRATIVE_FAILED
RENDER_FAILED
APPROVAL_REJECTED
PUBLISH_FAILED
```

Every transition records:

- audit ID;
- prior state;
- next state;
- timestamp;
- actor;
- reason;
- execution ID;
- code version;
- relevant artifact key.

---

# 8. Build method

- one phase per PR;
- no mixed report and pipeline changes;
- no feature additions during the rebuild;
- no claim-based acceptance;
- every production fix adds a permanent acceptance case;
- every phase has a rollback point.

---

# 9. Rebuild phases

## Phase 0 — Freeze and inventory

Deliver:

- production tag;
- report golden master;
- current architecture map;
- keep/refactor/replace/remove inventory;
- current payload fixtures;
- current known-good report fixture.

## Phase 1 — Contracts

Deliver:

- Audit Request schema;
- Source Result schema;
- Canonical Evidence schema;
- Finding schema;
- Score schema;
- Report Content schema;
- Narrative Response schema;
- Report View Model schema.

## Phase 2 — Artifact storage

Deliver:

- central `ArtifactStore`;
- test, staging and production implementations;
- SHA and byte verification;
- immutable object naming;
- manifest support.

## Phase 3 — Orchestration and lifecycle

Deliver:

- `AuditOrchestrator`;
- state machine;
- idempotency;
- resumable source execution;
- source failure isolation.

## Phase 4 — Adapter migration

Move one provider at a time behind the source contract.

## Phase 5 — Deterministic evidence and scoring

Lock evidence before module gates, findings or scores.

## Phase 6 — n8n and LLM boundary

Send one compact report-content package and receive constrained narrative JSON.

## Phase 7 — Locked renderer integration

Render the unchanged report and enforce golden-master tests.

## Phase 8 — End-to-end acceptance

Prove all source states, storage, n8n, renderer, approval and publication.

## Phase 9 — Controlled pilot

Run five to ten audits and record quality, cost, duration and review effort.

---

# 10. Definition of done

Prysm is launch-ready only when:

- every source uses the universal contract;
- missing evidence cannot create false scoring;
- permanent artifacts use object storage;
- every artifact is hash-verifiable;
- the full lifecycle is explicit;
- n8n is bounded and replayable;
- live LLM cost is capped;
- the report golden master passes;
- draft reports are inaccessible;
- approval is required;
- controlled pilots pass.
