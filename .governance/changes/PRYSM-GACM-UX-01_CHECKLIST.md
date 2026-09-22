# PRYSM GACM UX Closure — Frozen Checklist

**Change ID:** PRYSM-GACM-UX-01  
**Release intent:** STAGING_READY (local work may proceed; hosted acceptance remains gated on direct staging path and identity proof)  
**Starting SHA:** `2827d3411388541f6da274e4fc427e07c7618149`  
**Branch:** `repair/prysm-canonical-report-ux-20260922`  
**Frozen before implementation:** 2026-09-22

## Scope

Permitted: `services/worker/src/report/render-report-v2.js`, `services/worker/src/orchestration/audit-orchestrator.js` and `services/worker/src/narrative-v2/production-path.js` only to keep structural finalization contracts aligned with the canonical report, corresponding finalization tests, `services/worker/src/report/report-detail-sections.js` only for client-safe error projection, `services/worker/src/report/remediation-taxonomy.js` only for disclaimer copy (taxonomy keys, content, and sequence semantics stay frozen), narrowly required shared client-projection/presentation helpers, their focused tests, report browser/print acceptance support, this checklist, and the requested external proof folder.

Prohibited: scoring, evidence collection/authority, canonical priority selection/order, remediation taxonomy semantics, persisted report schemas, auth/tenant/runtime configuration, v1 renderer/design, migrations, production resources, and paid-provider operations.

## Acceptance IDs

- **GACM-01 Authority:** verify the exact starting commit and record actual `main` refs. No rebase, merge, or overwrite.
- **GACM-02 Canonical design:** retain Report Design v2.0.0 green tokens, masthead, rounded frame/card family, metadata, and seven page destinations. Add only compatible elements.
- **GACM-03 Language:** use short client-safe copy; preserve evidence scope/state and uncertainty; omit raw errors and internal rule IDs from visible text.
- **GACM-04 Dimensions:** show existing `computePillars` outputs as horizontal bars; preserve exact scores and existing capability labels; null stays “Not assessed.”
- **GACM-05 Evidence:** show existing confidence band and source/capability statuses; do not calculate a new percentage or collapse source states.
- **GACM-06 Primary blocker:** use only the first accepted priority group; show the no-priority state when empty; never promote supporting findings.
- **GACM-07 Implementation:** derive helper/dependency wording only from validated canonical solution metadata and detected platform evidence; unknown/insufficient evidence says “Needs checking.”
- **GACM-08 Journey:** use the four requested stage labels; derive context only from accepted, evidence-linked units and governed registry metadata; unsupported stages say “Not established”; no stage score.
- **GACM-09 Timeline:** render the existing taxonomy-projected FIRST/NEXT_7_DAYS/BY_30_DAYS slots in their governed order; malformed/unsupported data fails closed; no renderer-authored fixes.
- **GACM-10 Single action authority:** Priority Fixes remains the only ordered corrective sequence. No second sequence on Supporting Detail, Journey, Content, Trust, or Competitor pages.
- **GACM-11 Generalization:** test independent generic service, SaaS, professional-service, and ecommerce-like inputs plus sparse/partial evidence and zero/one/multiple accepted priorities; no client-name, audit-ID, phrase, or score conditionals.
- **GACM-12 Responsive/accessibility:** semantic labels, text values, keyboard-independent meaning, narrow viewport fit, and static print representation.
- **GACM-13 Print:** all seven views and combined report render without clipped/blank content, broken page breaks, or hidden essential evidence.
- **GACM-14 Regression:** focused renderer/projection/remediation tests, acceptance-prysm, whole-app P-B01–P-B17, worker regression, web type/build, and exact-candidate diff audit.
- **GACM-15 Hosted staging:** before any deploy, read-only prove Preview Vercel deployment and Railway staging identities and the full existing report retrieval path; staging identity ambiguity blocks deployment. No production mutation or fresh paid audit.
- **GACM-16 Independent audit:** independently inspect exact candidate and adversarial requirements before commit/push.

## Acceptance freeze

- Entry for local proof: deterministic `renderReportV2` over valid governed report models created from existing scorer/ontology contracts.
- Real production modules: v2 renderer, pillar projection, accepted priority projection, canonical remediation projector, current supported report contract.
- Persistence/hosted acceptance: existing Vercel Preview → authenticated report route → Railway staging worker → staging persistence/artifact → report route/view → browser/print. No persistence logic changes are permitted.
- Positive result: visible report preserves canonical design and seven pages while requested summaries derive only from existing governed data.
- Negative result: missing evidence, unknown stage/platform, malformed sequence, or absent accepted priorities remain explicitly unknown/unavailable; no invented score, stage, blocker, action, or cause.
- Forbidden calls/writes: no live provider/model calls, no new audit, no production mutation, no identity/config mutation, no merge, no production deploy.
- Exact verification command set is recorded in `07-TARGETED-TEST-PROOF.txt`, `13-FULL-REGRESSION-PROOF.txt`, and the terminal files.

## Status

All requirements were frozen before source implementation. Presentation helper and disclaimer-copy implementation has started; governing semantics remain frozen.
