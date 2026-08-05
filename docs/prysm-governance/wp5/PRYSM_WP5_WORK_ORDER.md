# Prysm WP5 — Governed Audit Orchestrator

## Branch

`feat/prysm-wp5-deterministic-reporting`

## Base

WP4 merge: `7d8436331980ad7d684376ea79b349245a7f0221`

## Goal

Create a dependency-injected `AuditOrchestrator` that executes a full production-shaped audit from `CREATED` through `EVIDENCE_LOCKED` using WP2 schemas, WP3 Artifact Store, WP4 lifecycle service, source plans, checkpoints, idempotency, and concurrency controls.

## Acceptance Gate

A full mocked audit reaches `EVIDENCE_LOCKED` with:

- Every planned source independently executed
- Raw provider payloads persisted and verified
- Normalized source results validated and persisted
- Canonical evidence validated and physically verified
- No report, scoring, n8n, or real-provider execution

## Scope Locks

WP5 owns only:

- `services/worker/src/orchestration/**`
- `services/worker/test-fixtures/orchestration/**`
- `services/worker/scripts/acceptance-wp5.js`
- `services/worker/package.json` (scripts only)
- `.github/workflows/worker-ci.yml` (CI steps only)

WP5 imports but does NOT modify: WP2 schemas, WP3 Artifact Store, WP4 lifecycle service, source plans, checkpoints, state enum, errors.

WP5 MUST NOT: score, find, render, call n8n, call LLMs, make real provider calls, modify approved reports, deploy, merge.

WP6 owns adapter migration.

## Deliverables

1. `createAuditOrchestrator()` factory
2. Mocked adapters conforming to `execute()` interface
3. Timeout and retry boundary with injected policies
4. Source execution in deterministic plan order
5. Artifact persistence with read-back verification
6. Canonical evidence assembly
7. Concise execution summary
8. Full test suite (13 behavioral requirements)
9. `test:orchestrator` and `acceptance:wp5` commands
10. CI integration with PostgreSQL 16
