# PRYSM-V2-RENDER-01 — Required V2 Report Section Contract Closure

Frozen 2026-08-17. Governing defect: the v2 renderer omits required informational areas
(topical/content opportunities, CMS & platform constraints, internal-link opportunities)
that the governed required-section contract mandates. Proven against production audit
6a60926f-398a-4295-9fb3-a80dd38a983a (report-v2/pages/index.html).

Production boundary: `services/worker/src/report/render-report-v2.js` only.
Tests: `services/worker/src/report/render-report-v2-sections.test.js`.
No scoring, evidence-collection, lifecycle, auth, or v1 changes.

---

## V2R-01 — Topical/content opportunities section

- Behavior: when `model.contentIdeas` contains tofu/mofu/bofu/leading entries, the v2 HTML renders a governed topical/content section listing the canonical ideas (idea, frame, type, question, priority) and leading queries (query, rationale, priority).
- Production target: `renderReportV2(model)` output for the scored v2 model.
- Assertion: rendered HTML contains the section heading and the exact canonical idea texts from the fixture model (semantic content, not arbitrary strings).
- PASS value: all fixture idea texts present, section heading present, anchor id stable.
- Prohibited: invented ideas; ideas not present in the model; v1 16-page layout.
- File boundary: `render-report-v2.js`.

## V2R-02 — CMS/platform constraints section

- Behavior: the v2 HTML renders a CMS/platform section from `model.evidence.site.platform` (platform row, risk classification from captured platform signals, feasibility table) matching the v1 content contract.
- Assertion: rendered HTML contains the platform value and the section heading; "Unknown" platform renders the governed uncertain-risk state.
- PASS value: platform value appears; risk line present; feasibility rows present.
- Prohibited: platform values not present in evidence; fabricated hosting/server details.
- File boundary: `render-report-v2.js`.

## V2R-03 — Internal-link opportunities section

- Behavior: when `model.evidence.internalLinkOpportunities` exists, the v2 HTML renders opportunities with canonical sourceUrl, targetUrl, proposedAnchor, reasonForLink, confidence (plus excluded/orphan/limitation layers and broken-link rows from `model.evidence.site.brokenInternalLinks`).
- Assertion: rendered HTML contains the exact fixture source/target/anchor/reason/confidence values.
- PASS value: all fixture opportunity fields present; broken-link rows present when supplied.
- Prohibited: fabricated URLs/anchors; inventing opportunities when absent.
- File boundary: `render-report-v2.js`.

## V2R-04 — Explicit unavailable/deferred state instead of silent omission

- Behavior: when any required section has no eligible data, the section heading still renders with an explicit governed unavailable/not-computed/deferred note (never a silent omission).
- Assertion: for a fixture model without contentIdeas/platform/internal-link data, all three section headings still appear, each with an explicit unavailable note.
- PASS value: three headings present with explicit state text; no fabricated content in those sections.
- Prohibited: silent omission of the informational area; turning absence into a business failure.
- File boundary: `render-report-v2.js`.

## V2R-05 — No evidence fabrication

- Behavior: every rendered URL, idea, finding, recommendation, score, and claim comes from the model; nothing invented by the renderer.
- Assertion: for a controlled empty fixture, the rendered HTML contains none of a set of sentinel invented values; for a populated fixture, every rendered opportunity/idea traces to a fixture value.
- PASS value: zero sentinel hits; complete traceability in the populated case.
- Prohibited: renderer-generated evidence of any kind.
- File boundary: `render-report-v2.js`.

## V2R-06 — Existing v2 sections unchanged

- Behavior: scorecard, pillars, blockers, paths, competitors, evidence-detail sections remain structurally and semantically intact.
- Assertion: the existing section headings and golden substrings (A. Conversion Readiness … E. What should be fixed first?, Evidence detail, Source statuses) remain present post-change.
- PASS value: all golden substrings present.
- Prohibited: reordering or rewriting existing sections beyond adding the new sections to the supporting layer.
- File boundary: `render-report-v2.js`.

## V2R-07 — v1 renderer/report unchanged

- Behavior: v1 renderers and golden output are untouched by this correction.
- Assertion: SHA-256 of the environment-stable STRUCTURAL fingerprint (section ids + heading literals) of `renderReport(model)` for the frozen fixture equals the pre-change golden; no v1 file appears in the change diff.
- PASS value: structural-hash equality + diff scope contains no v1 renderer files.
- Prohibited: any v1 output change.
- File boundary: none (v1 files must not appear in the diff).

## V2R-08 — Complete required-section structural contract

- Behavior: the v2 draft represents the complete required informational section contract (15 areas), each either rendered or explicitly unavailable/suppressed.
- Assertion: the rendered HTML contains all 15 required area markers (sections or explicit state markers).
- PASS value: 15/15 markers present.
- Prohibited: an arbitrary subset of the contract.
- File boundary: `render-report-v2.js`.

## False-PASS audit (pre-implementation)

- V2R-01/02/03/04/08 must FAIL against the pre-fix renderer (the defect harness).
- V2R-07 hash must be captured pre-change.
- No test may copy expected HTML from the implementation.

## Prohibited scope

No changes to scoring, scoring version, evidence collection, adapters, lifecycle,
orchestrator, audit-request persistence, report-design selection, Cognito, tenant
isolation, reviewer auth, artifact storage, credentials, or v1 design. No correction
of the "3 of 0 images" MINOR. No production audit, no provider/LLM calls, no DB changes.
