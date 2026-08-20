# PRYSM Narrative v2 — Karen-Style Regression Gate

Change ID: `PRYSM-NARRATIVE-V2-KAREN-REGRESSION`
Version: `1.0.0`
Change class: proof-only regression gate
Production effect: none

## Objective

Prove that the governed Narrative v2 browser/PDF report does not lose the diagnostic depth, evidence detail, or practical usefulness represented by the historical Karen Leslie report standard.

This gate is semantic, not cosmetic. The old HTML structure, section IDs, colours, or interaction model are not requirements. The information areas and decision usefulness are.

## Frozen historical benchmark

The canonical `karen-leslie-template.html` navigation defines 13 historical benchmark areas:

1. Scorecard
2. Priority Fixes
3. Conversion Paths
4. Readiness Map
5. Content Ideas
6. Competitor Benchmark
7. E-E-A-T Trust
8. CMS Constraints
9. Technical Hygiene
10. Headings
11. Schema
12. Performance
13. Evidence

The regression test reads the actual template and first proves those labels remain the repository benchmark.

## Semantic equivalence rule

The modern report may rename or reorganize a historical area only when the client still receives the same or greater decision information.

Frozen mappings:

- Scorecard → Conversion Readiness + Evidence Confidence + Evidence Coverage
- Priority Fixes → What should be fixed first
- Conversion Paths → Conversion path architecture
- Readiness Map → five-pillar problem map + foundational readiness
- Content Ideas → Topical Map & Content Opportunities
- Competitor Benchmark → Competitive context
- E-E-A-T Trust → E-E-A-T Trust Readiness Detail
- CMS Constraints → CMS & Platform Constraints
- Technical Hygiene → Technical Detail
- Headings → Heading Structure — Evaluated Page
- Schema → Schema & Entity Signals
- Performance → Performance Detail
- Evidence → Evidence detail + Source statuses + Evidence capabilities

## Required modern depth beyond the old navigation

The regression also requires the deterministic v2 report to retain:

- Internal-Link Opportunities
- Machine Readability
- What Is Already Good
- Client Action Plan
- Deferred & unavailable analysis

These are not optional merely because they were not first-level Karen navigation labels.

## Narrative v2 decision-usefulness requirement

Narrative v2 must add, not replace, the diagnostic layer. The client-facing narrative must include:

- Executive conclusion
- Verified strengths
- Root cause
- Business meaning
- Funnel opportunities
- Evidence boundaries / limitations
- Action plan
- Preserve / change / do-next executive decision

## Evidence-lineage requirement

Every rendered substantive narrative atom must retain the exact governed evidence reference as HTML metadata. Internal IDs must not be exposed as visible client prose.

## Protected boundaries

This change is proof-only and MUST NOT:

- modify production runtime code;
- modify any renderer implementation;
- modify scoring, evidence, provider, storage, lifecycle, or web routes;
- activate Narrative v2 in production;
- merge or deploy;
- make provider or LLM calls.

## Proof

`karen-style-regression.test.js` must prove:

1. the historical template still defines the 13 frozen benchmark areas;
2. every historical area has semantic coverage in the modern report surfaces;
3. additional deterministic diagnostic depth is retained;
4. Narrative v2 adds executive decision usefulness rather than replacing evidence detail;
5. narrative atoms retain exact evidence-lineage metadata;
6. a passing client narrative and deterministic evidence surface are both required.

## Frozen scope

Allowed files:

- `services/worker/src/report/karen-style-regression.test.js`
- `.governance/changes/PRYSM-NARRATIVE-V2_KAREN_REGRESSION_CHECKLIST.md`

No runtime file is authorized for this gate. If the regression fails because a report capability is genuinely absent, stop and open a separate surgical correction scope rather than weakening this benchmark.
