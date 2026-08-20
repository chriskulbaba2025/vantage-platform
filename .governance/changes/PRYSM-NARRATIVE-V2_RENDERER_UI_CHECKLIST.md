# PRYSM Narrative v2 — Renderer / UI Wiring Gate

Change ID: `PRYSM-NARRATIVE-V2-RENDERER-UI`
Version: `1.0.0`
Change class: additive governed rendering bridge
Production effect: none until separately wired into the active v2 lifecycle

## Objective

Render the governed Narrative v2 release candidate into the existing report-design-v2 browser/PDF artifact without weakening evidence lineage, rewriting deterministic evidence, or modifying the historical v1 report path.

## Frozen composition

The browser/PDF artifact is layered in this order:

1. existing report-v2 navigation;
2. governed Narrative v2 executive layer;
3. existing deterministic report-v2 scorecards, pillars, findings, implementation detail and evidence layer.

The Narrative v2 executive layer renders:

- executive conclusion;
- verified strengths;
- root cause and business consequences;
- conversion interpretation;
- content and topical architecture;
- funnel opportunities;
- SEO and SERP;
- AI search readiness;
- E-E-A-T and trust;
- technical foundations;
- performance and UX;
- competitive position;
- limitations;
- prioritized action plan;
- executive preserve/change/do-next decision.

## Evidence-lineage rule

Every Writer narrative atom already carries exact `WriterInput.referenceIndex` IDs. The renderer preserves those IDs as non-visible `data-evidence-refs` attributes on the exact rendered prose node.

Client-facing browser/PDF prose does not expose internal evidence IDs as citation text. The IDs remain in the immutable HTML artifact for audit traceability.

## Release-candidate rule

The governed bridge accepts only an orchestration result with:

- status `RELEASE_CANDIDATE`;
- final WriterOutput present;
- final Judge response present and `PASS`;
- pass numbers coherent with orchestration pass count;
- audit IDs coherent across WriterInput, orchestration result and WriterOutput;
- final WriterOutput re-validating against the supplied WriterInput.

Anything else fails closed before client HTML is returned.

## Existing-report preservation

The bridge calls the existing `renderReportV2()` unchanged and injects the governed narrative layer into the resulting report shell.

The existing deterministic report remains present, including:

- Conversion Readiness;
- Evidence Confidence;
- Evidence Coverage;
- five pillars;
- prioritized blockers;
- foundation readiness;
- conversion-path architecture;
- competitive context;
- topical/content opportunities;
- E-E-A-T detail;
- technical detail;
- heading structure;
- schema/entity detail;
- performance detail;
- machine readiness;
- CMS/platform constraints;
- internal-link opportunities;
- deterministic strengths/action plan;
- deferred/unavailable analysis;
- deep evidence detail and source statuses.

## Protected boundaries

This change MUST NOT:

- modify v1 renderer files;
- modify the active audit orchestrator;
- activate Narrative v2 in production;
- alter scoring or evidence collection;
- alter provider terminology or canonical field names;
- call any provider or LLM;
- merge or deploy automatically.

## Deterministic proof

`render-narrative-v2.test.js` proves:

1. a real governed orchestration `RELEASE_CANDIDATE` renders the complete Narrative v2 section set;
2. the existing deterministic report-v2 evidence/detail layer remains present;
3. evidence IDs are embedded as metadata rather than visible client citation prose;
4. non-release orchestration results fail closed;
5. invalid WriterOutput fails revalidation before client HTML is returned;
6. repeated browser/PDF composition is byte-identical and retains print/navigation behavior.

## Frozen scope

Allowed files for this change:

- `services/worker/src/report/render-narrative-v2.js`
- `services/worker/src/report/render-narrative-v2.test.js`
- `.governance/changes/PRYSM-NARRATIVE-V2_RENDERER_UI_CHECKLIST.md`

No other file is authorized without a new scope decision.
