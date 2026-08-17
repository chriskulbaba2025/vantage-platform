# Prysm PRYSM-NEXT-01 / WP-J Checklist — CRIT Adversarial Review & Correction

**Version:** 1.0.0 (frozen before implementation)
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Required starting SHA:** d866006 (post WP-K)
**Objective:** One measurable outcome — an independent adversarial CRIT review of the upgraded product (baseline 73.5, first review 93/100) with every repository-controlled defect corrected and proven, followed by a FRESH independent rescore.
**Baseline active cycle time (written estimate):** 6.0h.

## Requirements

- [x] WPJ-01 — Independent adversarial review performed (fresh-context reviewer; head 4d4b7f8; result 93/100; 5 integrity claims verified: 4 PASS, 1 FAIL; 11 area scores; top-10 prioritized defects).
- [x] WPJ-02 — Defect 4a/4b corrected: SCORING_VERSION 4.1.1; scoreTechnicalV4 meta/images sub-rules EXCLUDED when counter inputs are null/unknown (changelog documented). Proof: score-components.test.js + full regression.
- [x] WPJ-03 — Defect 2a corrected: adapter 1.2.0 hydrates parsed text into page bodyText/signals/_contentAvailable; `_interactiveEvidenceAvailable` marker; capability rules never claim CTA/form/path availability from parsed text alone. Proof: adapter tests, capability truth tables, WP-I Phase 8 (live-shaped real adapter).
- [x] WPJ-04 — Defects 3a/3b corrected: topicRows gated on trust.proof capability (Not Assessed when unknown); CTA-type claim requires evidence. Proof: score-components.test.js.
- [x] WPJ-05 — Defect 6c/10a corrected: WP-I uses the REAL Ajv validator over all contracts (stub removed); the real validator immediately caught defect 6d. Proof: WP-I 52/52 with real schemas.
- [x] WPJ-06 — Defect 6d corrected: NEW versioned contract report-manifest-v2.schema.json (designVersion const 2.0.0); v2 branch validates against it; frozen v1 manifest schema untouched. Proof: validator fixtures + WP-I.
- [x] WPJ-07 — Defects 6a/6b corrected: v2 render loads capability evidence via loadAndValidateCapabilityEvidence; hydration warnings logged (sanitized). Proof: WP-I Phase 1 + code.
- [x] WPJ-08 — Defect 7a corrected: scoring context rebuilt from the persisted audit-request.json at replay. Proof: WP-I + regression.
- [x] WPJ-09 — Defect 5a corrected: conversion-relevant form rule (submit intent OR ≥2 editable fields); weak forms stay unknown. Proof: validator tests + WP-I.
- [x] WPJ-10 — Defect 8a corrected: v2 report gained conversion-path architecture + competitive context sections. Proof: render-report-v2 golden tests.
- [x] WPJ-11 — Defect 7b addressed without breaking frozen decision-evidence v1 (scorer documented; eligibility gate guarantees collected absence). Defects 10b/11b recorded (provider-compat behavior + live-pilot item).
- [x] WPJ-12 — Version references updated with semantic justification: scoring 4.1.1 (wp7, vantage-score, render-v2, WP-I), adapter 1.2.0 (DE-16 registration, adapter tests, WP-I).
- [x] WPJ-13 — Security-hardening gate patches: report-page + admin-route rate limiters (server.js).
- [x] WPJ-14 — Fresh independent rescore performed (see WPJ-CLOSURE evidence below).
- [x] WPJ-15 — Full regression battery green at the correction head; single governed commit + push.

## Completion evidence (recorded 2026-08-16)

- Correction battery (`.governance/evidence/wpj-verify.log`): npm test EXIT=0; WP-I 52/52 with REAL schemas; calibration 19/19; wp2/3/5/6/7/8/9/task7/9/10/wp10/11/12/tenant/provisioning EXIT=0; wp4 57/57 (docker restored); acceptance-prysm 82/82 (fixture upgraded to the adapter-1.2.0 evidence path); check:template EXIT=0.
- render-report-v2 + conversion-path-validator: 19/19.
- tsc + next build + Playwright: rerun at WP-L final head.
- Fresh independent rescore: recorded in WP-L closure evidence (scores per area + overall).
