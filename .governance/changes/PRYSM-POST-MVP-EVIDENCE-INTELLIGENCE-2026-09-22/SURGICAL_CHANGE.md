# Surgical Change Determinacy

## Producer

Governed audit collection and decision-evidence hydration.

## Contract

Stable tenant/audit/source/page-scoped evidence records, explicit conflict
state, additive evidence-reconciliation artifact, and stable graph nodes/edges.

## Consumers

PostgreSQL or local memory evidence repository, Ask PRYSM deterministic query
layer, and future report projections.

## Invariants

- unknown, partial, conflict, and historical observations remain explicit;
- tenant and audit scope are mandatory on persistence and reads;
- duplicate observations are stable and idempotent;
- artifact bytes are reloaded, checksummed, and verified;
- existing canonical evidence and report lifecycle remain intact.

