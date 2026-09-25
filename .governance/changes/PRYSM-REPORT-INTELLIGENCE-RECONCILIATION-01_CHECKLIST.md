# PRYSM-REPORT-INTELLIGENCE-RECONCILIATION-01 — Frozen Checklist

Release intent: STAGING_READY
Starting SHA: 105792ea3eaab4b3032bde69571fd5bb5d2da163
Branch: repair/prysm-report-intelligence-reconciliation-20260925

## Scope

Permitted source/test files:
- services/worker/src/report-intelligence/client-presentation.js
- services/worker/src/report-intelligence/client-presentation.test.js
- services/worker/src/report-intelligence/semantic-ledger.js
- services/worker/src/report-intelligence/semantic-ledger.test.js
- services/worker/src/report/render-report-v2.js
- services/worker/src/report/report-detail-sections.js
- services/worker/src/report/render-report-v2-conversion.test.js

Prohibited:
- evidence acquisition/provider integrations
- scoring measurements or evidence-state semantics
- lifecycle/persistence/authentication
- AWS
- production
- benchmark-site/domain/audit-specific code

## Frozen acceptance requirements

RI-R01 — The client renderer consumes one deterministic client-presentation contract derived from immutable evidence plus the semantic ledger.
Positive proof: primary report pages use the contract.
Negative proof: no model may rewrite evidence status, score, measurement, or provenance.

RI-R02 — Client priority order is materiality-aware.
Positive proof: direct conversion/trust/offer/friction/decision-support outrank acquisition/technical cleanup when both are supported.
Negative proof: low-confidence evidence cannot lead merely because its category ranks higher.

RI-R03 — Conversion Journey contains only evidence with a defensible buyer-journey relationship.
Positive proof: conversion/trust/offer/friction/decision-support findings may appear.
Negative proof: schema/meta/technical hygiene alone cannot be rendered as visitor momentum loss.

RI-R04 — Content opportunities consume semantic coverage/action classification.
Positive proof: CREATE/IMPROVE/etc. reflect assessed coverage.
Negative proof: NO_ACTION and generic ontology-filling suggestions do not appear as primary content work.

RI-R05 — Trust/proof rendering recognizes equivalent proof forms without fabricating case studies.
Positive proof: customer stories/results and completed-work/gallery forms are represented with correct qualifiers.
Negative proof: gallery/completed-work evidence is not called a detailed outcome case study without support.

RI-R06 — Deterministic evidence conflicts are reconciled in client language.
Positive proof: observed pricing/proof plus a scoped negative finding is explained as scope/placement conflict.
Negative proof: the report must not silently say the same concept is both present and absent.

RI-R07 — Competitor client-side values reuse available own-site evidence.
Positive proof: assessed own-site content/proof/path values do not fall back to “Not enough evidence” merely because comparator normalization lacks a parallel field.
Negative proof: competitor evidence cannot create a client defect.

RI-R08 — Tracking/referral parameters are removed from client-facing URLs without changing resource identity.
Positive proof: utm_*, gclid and fbclid are stripped.
Negative proof: raw evidence objects remain unchanged.

RI-R09 — Executive score interpretation explains material score/narrative scope mismatches.
Positive proof: a strong composite Conversion Path score plus a weak reviewed primary path is explicitly qualified.
Negative proof: scores are not changed.

RI-R10 — Verification language is finding-specific where a governed verification method or specific check exists.
Positive proof: executive and priority actions use finding-specific verification.
Negative proof: no fabricated business-outcome verification.

RI-R11 — Generalization proof covers strong, weak, mixed, partial, unavailable, technical-low-impact, buyer-impact, content-present, tracking-contaminated, proof-equivalence, competitor-own-site, and contradiction cases.

RI-R12 — Targeted tests, full worker regression, applicable Whole-App gate and exact-head audit pass before human UAT.

## Stop boundary

Stop after an exact staging-ready candidate and machine-verifiable gates are complete. Do not mutate production. Do not make AWS production changes. Human browser/UAT is the next boundary.
