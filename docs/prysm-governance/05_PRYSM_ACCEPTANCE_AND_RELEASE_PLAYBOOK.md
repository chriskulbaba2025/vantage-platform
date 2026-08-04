# Prysm Acceptance and Release Playbook

**Version:** 1.0.0  
**Status:** Mandatory release gate

---

# 1. Principle

A pull request is not accepted because unit tests pass or an agent reports confidence.

A release is accepted only when machine-generated evidence proves the affected production path.

---

# 2. Test layers

## Layer 1 — Unit

Pure functions, validators, normalizers, scoring rules, finding rules and state transitions.

No network. No permanent filesystem. No LLM.

## Layer 2 — Contract

Every adapter runs against the same universal source-contract suite.

## Layer 3 — Artifact

Proves write, read-back, exact bytes, exact SHA-256, content type, immutable key and surfaced failure.

## Layer 4 — Integration

Proves orchestrator, artifact store, canonical evidence, gates, findings, scoring and state transitions using production-shaped fixtures.

## Layer 5 — n8n replay

Proves compact request, cache key, replay response, validation and report view model with zero live model calls.

## Layer 6 — Report golden master

Proves page count, order, HTML structure, CSS checksums, screenshots, print screenshots and access rules.

## Layer 7 — Staging end-to-end

Proves the deployed system with controlled fixtures and object storage.

## Layer 8 — Controlled production acceptance

Uses deliberate and bounded live provider calls.

No acceptance depends on manual container inspection.

---

# 3. Required scenarios

| Scenario | Required status | Score behaviour |
|---|---|---|
| Complete crawl | `AVAILABLE` | Eligible modules score |
| Page ceiling | `PARTIAL` | Coverage and limitation visible |
| Robots block | `BLOCKED` | Dependent modules Not Assessed |
| Login block | `BLOCKED` | Dependent modules Not Assessed |
| Provider timeout | `FAILED` | Dependent modules Not Assessed |
| No useful result | `UNAVAILABLE` | Dependent modules Not Assessed |
| GA4 absent | `NOT_CONNECTED` | No unrelated penalty |
| GSC absent | `NOT_CONNECTED` | No unrelated penalty |
| PageSpeed failure, Lighthouse success | valid fallback state | Provenance visible |
| Both performance providers fail | failure state | Performance Not Assessed |
| Competitor source partial | `PARTIAL` | Only supported comparisons |
| n8n unavailable | audit retained | Narrative retryable |
| renderer failure | `RENDER_FAILED` | No client report exposed |

---

# 4. Required assertions

For every relevant scenario verify:

- source status;
- limitation;
- task/request ID;
- record count;
- coverage;
- physical artifact existence;
- stored bytes;
- stored SHA;
- canonical schema;
- module gates;
- no false zero score;
- report language;
- evidence appendix entry.

---

# 5. Determinism suite

Run the same canonical evidence fixture multiple times.

Assert:

- same rules;
- same priorities;
- same scores;
- same assessed weight;
- same report-content hash;
- same page structure;
- same renderer output under narrative replay.

---

# 6. Cost suite

Assert:

- unit and integration tests make zero live model calls;
- replay makes zero live model calls;
- live mode enforces maximum calls;
- repair cannot exceed one;
- hard budget blocks execution;
- daily budget blocks execution;
- cache hits avoid calls;
- usage and cost are recorded.

---

# 7. Security suite

Assert:

- secrets are absent from artifacts;
- secrets are absent from n8n payloads;
- user-level GA4 records are absent;
- cross-client object access is rejected;
- draft report routes are rejected;
- path traversal is rejected;
- unapproved reports are not public;
- override history is preserved.

---

# 8. Pull request gates

Every PR states:

- phase;
- scope;
- prohibited changes;
- contracts affected;
- tests added;
- acceptance command;
- rollback method.

Reject a PR when:

- it changes report files without a report-design version;
- it hardcodes a workstation path;
- it commits generated runtime artifacts;
- it uses live provider or LLM calls in CI;
- it hides persistence failure;
- it broadens scope;
- it changes scores without a scoring version;
- it changes a schema without a schema version.

---

# 9. Deployment order

1. merge phase PR;
2. verify CI;
3. deploy to staging;
4. run phase acceptance;
5. verify the release record;
6. deploy to production;
7. run controlled smoke test;
8. monitor;
9. retain rollback target.

Do not combine staging and production proof.

---

# 10. One end-to-end command

The rebuild ends with one command, for example:

```powershell
npm run acceptance:prysm
```

It outputs:

```text
Contracts                 PASS
Artifact storage           PASS
Source states              PASS
Deterministic scoring      PASS
n8n replay                 PASS
LLM budget controls        PASS
Report golden master       PASS
Draft access control       PASS
Approval gate              PASS
Published report           PASS
```

A failure exits non-zero and points to a stored diagnostic artifact.

---

# 11. Pilot gate

Run five to ten client-shaped audits.

Record:

- input completeness;
- source status matrix;
- provider failures;
- false positives;
- false negatives;
- score consistency;
- report completeness;
- visual result;
- provider cost;
- LLM cost;
- run time;
- auditor review time;
- approval decision.

Launch only after Principal Auditor approval.

---

# 12. Rollback

Every deployment identifies:

- previous known-good commit;
- previous workflow version;
- previous prompt version;
- previous report-design version;
- database migration rollback;
- feature flag for the prior pipeline.

Introduce the new pipeline behind a feature flag until the pilot passes.
