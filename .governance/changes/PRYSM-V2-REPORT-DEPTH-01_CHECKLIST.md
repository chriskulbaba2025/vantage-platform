# PRYSM-V2-REPORT-DEPTH-01 — Conversion-First Section E + Governed Report Depth

Status: PROOF HARNESS FROZEN → IMPLEMENTED → VERIFIED
Branch: `fix/prysm-conversion-report-improvements`
Base (verified production main): `9e0006ac99f68f5293f37c63453728c511b4125a`
Scope: report design v2 renderer, action-priority calculation, deterministic
report-language generators. No schema-version change. No dimension-weight change.

---

## 0. Governing boundaries observed

| Boundary | State |
|---|---|
| `decision-evidence.schema.json` 1.0.0 | UNCHANGED |
| `capability-evidence.schema.json` (capabilityEvidenceVersion 2.0.0) | UNCHANGED |
| `report-view-model.schema.json` 1.0.0 | UNCHANGED |
| `finding.schema.json` 1.0.0 (`additionalProperties: false`) | UNCHANGED |
| `SCORING_VERSION` 4.1.1 | UNCHANGED |
| `DIMENSIONS` readiness weights (25/25/20/20/10) | UNCHANGED |
| `MODULES` weights | UNCHANGED |
| `CONFIDENCE_MODIFIERS` | UNCHANGED |
| Provider calls in this package | 0 |
| v1 Karen Leslie implementation | UNCHANGED (comparison baseline) |

**Consequence of the frozen finding schema.** `finding.schema.json` sets
`additionalProperties: false`, so the action class CANNOT be persisted as a new
finding field. All classification, grouping, and foundation linkage in this
package is **derived at render time** from existing governed fields
(`ruleId`, `confidence`, `scoreBearing`, `finalPriority`, `severity`,
`implementationEffort`, `dimension`) plus capability/evidence state. No schema
change was required.

---

## 1. Section E — action-priority formula

### Before

```
Raw Priority = Conversion Impact          × 0.30
             + Gap Severity               × 0.25
             + Business Relevance         × 0.20
             + Competitive Signal         × 0.15
             + Implementation Practicality× 0.10
Final Priority = round(clamp(Raw) × Confidence Modifier)
```

### After (authorized)

```
Raw Priority = Conversion Impact          × 0.40
             + Business Relevance         × 0.20
             + Gap Severity               × 0.15
             + Implementation Practicality× 0.15
             + Competitive Signal         × 0.10
Final Priority = round(clamp(Raw) × Confidence Modifier)      [UNCHANGED]
```

Weights sum to 1.00. Confidence modifiers unchanged:
`deterministic 1.00 · strongly_supported 0.90 · supported 0.75 ·
directional 0.55 · insufficient 0 (non-score-bearing)`.

This calculation governs **recommendation/action priority only**. It does not
feed `conversionReadiness`, which is computed from module scorers
(`MODULES[].scorer`) and dimension weights — proven by CR-06.

### Foundation-blocker deterministic rule

A score-bearing finding is classified `FOUNDATION_BLOCKER` iff **all** hold:

1. `scoreBearing === true` (insufficient-confidence findings are excluded by
   construction), and
2. `confidence ∈ {deterministic, strongly_supported}` — i.e. confidence
   modifier ≥ 0.90, and
3. its `ruleId` maps to a governed foundation domain, **or** its `ruleId`
   appears in `linkedRuleIds` of a First Things First item whose status is
   `ACTION_REQUIRED` and which is marked conversion/discovery/measurement
   critical.

Governed foundation domains (evidence-gated, not a blanket list — a finding
only exists when its capability was available and its evidence was collected):

| Rule | Domain | Why foundational |
|---|---|---|
| `VAN-PATH-001` | `conversion_completion` | Browser-validated obstruction of the primary conversion action |

Everything else classifies as `HIGH_CONVERSION` (finalPriority ≥ 55) or
`OPTIMIZATION`. The confidence floor in (2) is what prevents a weakly-evidenced
foundation-domain finding from outranking a strong deterministic finding purely
by classification (CR-04).

**Honest boundary.** Today exactly one score-bearing rule qualifies. Rendering
diagnostics (`VAN-DIAG-*`) describe genuine rendering failures but are
`scoreBearing: false` by governed design, so they are excluded — the task
contract requires foundation blockers to be score-bearing. Additional
foundation domains (indexability, conversion measurement) surface through the
First Things First checklist and the Client Action Plan instead of being
fabricated as findings.

### Action grouping (deterministic)

| Group | Rule |
|---|---|
| `DO NOW` | `FOUNDATION_BLOCKER`, or (`HIGH_CONVERSION` and `confidence ∈ {deterministic, strongly_supported}` and `implementationEffort ∈ {L, M}`) |
| `DO NEXT` | remaining `HIGH_CONVERSION`, or `OPTIMIZATION` with `finalPriority ≥ 40` |
| `LATER / OPTIMIZE` | everything else |

Low effort alone never promotes to DO NOW — the `HIGH_CONVERSION` class
(finalPriority ≥ 55) is required first (CR-02 / quality gate Q2).

---

## 2. Karen Leslie → v2 inventory

Classification of every meaningful v1 element. Sources inspected in full:
`karen-leslie-template.html`, `render-report.js`, `render-approved-report.js`,
`sections-conversion.js`, `sections-trust.js`, `sections-seo.js`,
`sections-performance.js`, `sections-internal-links.js`, `html-helpers.js`.

Counts: **ALREADY PRESENT 12 · RESTORE 4 · RESTORE WITH GOVERNANCE CORRECTION 13 · DEFER 5 · RETIRE 10**

### ALREADY PRESENT in v2 (12)

| # | Element | v2 location |
|---|---|---|
| 1 | Executive scorecard (readiness / confidence / coverage) | `executiveScorecard` §A–C |
| 2 | Priority fixes | `blockersSection` §E |
| 3 | Conversion path architecture | `conversionPathSection` |
| 4 | Conversion readiness map (pillar view) | `pillarSection` §D |
| 5 | Topical map + content opportunities | `contentOpportunitiesSection` |
| 6 | Competitor benchmark (table) | `competitorSection` |
| 7 | Internal-link opportunities | `internalLinksSection` |
| 8 | Broken internal links (traced/untraced split) | `internalLinksSection` |
| 9 | Orphan / weakly linked pages | `internalLinksSection` |
| 10 | Evidence appendix (findings, source statuses, capabilities) | `deepEvidenceLayer` |
| 11 | Deferred & unavailable analysis | `deepEvidenceLayer` |
| 12 | Detected platform value | `cmsPlatformSection` |

### RESTORE (4) — v1 content is already governance-clean

| # | Element | v1 source | v2 target |
|---|---|---|---|
| 13 | Performance provider provenance / fallback / lab-vs-field note | `sections-performance.js:95-140` | `performanceDetailSection` |
| 14 | Mobile + desktop score & metric cards (Perf/A11y/BP/SEO, FCP/LCP/TBT/CLS) | `sections-performance.js:141-175` | `performanceDetailSection` |
| 15 | Multi-page tested-URL results | `sections-performance.js` pageResults | `performanceDetailSection` |
| 16 | Rendering-integrity diagnostics (site rendering vs provider/infra) | `sections-performance.js` renderingDiagnostics | `performanceDetailSection` |

### RESTORE WITH GOVERNANCE CORRECTION (13)

Each of these carried an `absence ⇒ negative` or `generic ⇒ site-fact` defect
in v1. Restored only behind an explicit capability/availability gate.

| # | Element | v1 defect (quoted) | Correction |
|---|---|---|---|
| 17 | E-E-A-T Experience | `caseStudies ? … : "No case-study or outcome proof detected."` | Gated on `trust.proof` capability; unassessed ⇒ `Not Assessed` |
| 18 | E-E-A-T Expertise | `credentials ? … : "No credentials or certifications detected."` | same gate |
| 19 | E-E-A-T Authoritativeness | `testimonials ? … : "No testimonial proof detected."` | same gate |
| 20 | E-E-A-T Trust | composes `"No schema; "`+`"no pricing context; "`+`"no policy reassurance."` from falsy booleans | same gate; schema uses `schema.structured_data` capability |
| 21 | E-E-A-T Found/Missing/Risk/Fix structure | every fix tagged `severity-high` unconditionally | Risk/Fix rendered only when the dimension was assessed; no unconditional severity tag |
| 22 | Technical: metadata | counts render even when `_metaFieldAvailability` is false | Per-field availability gate; unassessed ⇒ `Not Assessed` |
| 23 | Technical: page quality | Pass iff `averageWords>=300 && imagesMissingAlt===0` | Gated on `content.body` |
| 24 | Technical: page structure | `pages[0]?.headings?.h2?.length \|\| 0` — absent ⇒ 0 | Gated on `_metaFieldAvailability.headings` |
| 25 | Technical: server & security | `startsWith("https:") ? "Enabled" : "Not enabled"`; each header `? "Present" : "Missing"` | Gated on `technical.headers`; unassessed ⇒ `Not Assessed` |
| 26 | Technical: performance panel | `(model.scores.performance ?? 0) >= 70` — missing treated as 0 | Null score ⇒ `Not Assessed`, never 0 |
| 27 | Heading structure H1–H4 | H1 absent ⇒ `"Missing"`; H3/H4 absent ⇒ `"None detected"`; H2 always `"Review sequence"` | Explicitly scoped to the named evaluated page; issues only when headings evidence was collected |
| 28 | Schema / entity | six `? "Present" : "Missing"` rows incl. HTTPS as `"Missing"` | Split OBSERVED (detected types) vs RECOMMENDED (candidate types, never shown as detected); gated on `schema.structured_data` |
| 29 | CMS / platform implementation detail | 9 hardcoded feasibility rows + 4 hardcoded limitation bullets presented as site facts | Detected platform + server header only when captured; feasibility rendered as an explicitly-labelled generic verification checklist, not site-specific fact; migration risk only when platform evidence exists |

### DEFER — evidence not available (5)

| # | Element | Required evidence not collected today |
|---|---|---|
| 30 | Phase 2 authority growth (backlinks/reviews/entity mentions) | Rendered as explicit Phase-2 scope, not assessed in Phase 1 |
| 31 | Hosting / delivery detail beyond `pages[0].responseHeaders.server` | Response headers unavailable on the production DataForSEO path (`_responseHeadersAvailable === false`) |
| 32 | Social / entity corroboration | `socialLinks` present but no external entity verification source |
| 33 | Per-query GSC detail in competitor positioning | Governed model persists aggregates only |
| 34 | Competitor crawl-depth comparison | SERP evidence is metadata-only; crawl content exists only on the legacy path |

### RETIRE (10) — duplicate, low value, or unsafe

| # | Element | Reason |
|---|---|---|
| 35 | Gate Results table with hardcoded `PASS —` rows | Fabricated verification; contradicts its own source comment |
| 36 | Content-coverage `Moderate`/`Light` by array index | Coverage label with no coverage measurement |
| 37 | Conversion-path issue severity by list index (`index < 2 ? "high"`) | Severity not derived from evidence |
| 38 | AI-readiness sub-scores recomputed inside the renderer | Duplicates scoring logic; absence ⇒ 0/25. v2 renders the governed `scores.aiReadiness` only |
| 39 | `"en-CA"` language fallback | Generic value presented as the site's language |
| 40 | `score-red` styling for `Not Assessed` / `Unavailable` | Renders unavailable evidence as a defect |
| 41 | `observedValue ?? "unavailable"` in priority-fix evidence | Conflates absent value with assessed absence |
| 42 | Own-site `"Light"` benchmark label from absent evidence | Absence ⇒ negative qualitative label |
| 43 | Unconditional `Phase 1` / `High` severity tags on every E-E-A-T fix | Severity not evidence-derived |
| 44 | `readiness` printed as `null/100` in the v1 header | Null-unsafe display |

---

## 3. First Things First — foundational readiness checklist

Each candidate resolves to exactly one of
`PASS` · `ACTION_REQUIRED` · `NOT_ASSESSED` · `NOT_APPLICABLE`.
`ACTION_REQUIRED` is emitted **only** when evidence proves a deficiency.

| Candidate | Governed source | Can we truthfully assess? |
|---|---|---|
| HTTPS (URL scheme) | `site.targetUrl` / `pages[].crawledUrl` scheme | YES for scheme. Certificate validity explicitly NOT assessed |
| Site availability | `site.sourceStatus`, `site.statusCounts`, `site.coverage` | YES |
| Google indexability | capability `technical.indexability`, `site.nonIndexablePages[]` | YES when capability AVAILABLE/PARTIAL |
| Canonical tags | `site.missingCanonicals`, `_metaFieldAvailability.canonicals` | YES when the field was collected |
| XML sitemap | `site.sitemapUrls[]` | PASS when non-empty; empty ⇒ NOT_ASSESSED (empty ≠ absent on the production path) |
| Conversion mechanism | capabilities `conversion.cta` / `conversion.form`, `site.ctas`, `site.forms` | Only when interactive evidence ran (`_interactiveEvidenceAvailable !== false`) |
| Conversion measurement | `ga4.sourceStatus`, `ga4.measurementReadiness` | PASS / ACTION_REQUIRED only when GA4 is AVAILABLE. NOT_CONNECTED ⇒ NOT_ASSESSED |
| Primary contact information | `site.trust.contact`, `pages[].phoneLinks`, `pages[].emailLinks` | Only when `content.body` capability available |
| Basic security headers | `site.securityHeaders`, `_responseHeadersAvailable` | Production path ⇒ NOT_ASSESSED |
| Mobile experience | `performance.mobile` scores | Performance signal only; usability itself NOT_ASSESSED |
| robots.txt | `site.robotsText`, BLOCKED source status | Production DataForSEO returns `robotsText: ""` ⇒ NOT_ASSESSED unless BLOCKED |
| Bing indexability | — | NOT_ASSESSED — requires Bing Webmaster Tools API |
| Google Business Profile | — | NOT_ASSESSED — requires GBP API or SERP local-pack parsing |
| NAP consistency | — | NOT_ASSESSED — requires address extraction + a directory source |

Items that remain `NOT_ASSESSED` render the exact missing source, e.g.
`NOT ASSESSED — requires Bing Webmaster Tools API`. No paid provider call is
added by this package.

---

## 4. Frozen acceptance checklist

Every item below is binary, asserts observable output, and executes the real
production path (`scoreAudit` → `renderReportV2`, or the exported production
helper under test). Harness: `src/report/render-report-v2-conversion.test.js`
and `src/scoring/vantage-score.test.js`.

### Section E

| ID | Requirement | PASS condition |
|---|---|---|
| CR-01 | New 40/20/15/15/10 action-priority math | `calculateFindingPriority` raw equals the new weighted sum for controlled inputs; the old 30/25/20/15/10 sum is explicitly rejected |
| CR-02 | Confidence modifiers still applied unchanged | final = round(raw × modifier) for all five levels |
| CR-03 | Foundation blocker outranks ordinary optimization | `VAN-PATH-001` (strongly_supported) ranks above a higher-`finalPriority` optimization finding |
| CR-04 | Low-confidence blocker cannot outrank a strong deterministic finding by classification alone | a `supported`/`directional` foundation-domain finding is NOT classified `FOUNDATION_BLOCKER` and does not lead |
| CR-05 | Insufficient evidence remains non-score-bearing | `insufficient` ⇒ `final === 0`, `scoreBearing === false`, absent from Section E |
| CR-06 | Main readiness dimension weights unchanged | `DIMENSIONS` weights 25/25/20/20/10 and `conversionReadiness` are byte-identical before/after the priority change for a fixed fixture |

### Report restoration

| ID | Requirement | PASS condition |
|---|---|---|
| CR-07 | E-E-A-T renders Found/Missing/Risk/Fix, and `Not Assessed` when the capability is unavailable | assessed fixture ⇒ four dimensions with found/missing; unassessed fixture ⇒ `Not Assessed`, no "No … detected" text |
| CR-08 | CMS never claims unsupported admin/platform facts | feasibility block is labelled generic/verification; no hardcoded row asserts a site-specific admin capability; unknown platform ⇒ explicit unverified state |
| CR-09 | Technical sub-panels respect capability availability | headers unavailable ⇒ `Not Assessed`, never `Missing` |
| CR-10 | Headings scoped to the evaluated page | rendered heading block names the evaluated URL and does not imply a site-wide assessment |
| CR-11 | Observed vs recommended schema are distinct | detected types appear under OBSERVED; recommended types never appear as detected |
| CR-12 | Unavailable performance metrics render `Unavailable`, never `0` | absent LCP/CLS ⇒ `Unavailable`; no `0 ms` / `0.00` fabrication |
| CR-13 | Mobile/desktop detail stays provenance-aware | provider, lab-vs-field, and fallback state rendered from the model |
| CR-14 | Machine-readiness wording does not claim actual AI visibility | contains structural machine-readability wording; forbidden overclaim strings absent |
| CR-15 | Strengths require assessed evidence | unassessed fixture produces no strength entries derived from unavailable capabilities |

### First Things First

| ID | Requirement | PASS condition |
|---|---|---|
| CR-16 | Assessed foundation pass | https + available site ⇒ `PASS` rows present |
| CR-17 | Assessed foundation failure | proven non-indexable target ⇒ `ACTION REQUIRED` |
| CR-18 | Unassessed candidate | Bing/GBP/NAP ⇒ `NOT ASSESSED — requires …` |
| CR-19 | Not-applicable candidate | a candidate with `NOT_APPLICABLE` renders as such |
| CR-20 | Unavailable evidence never becomes ACTION REQUIRED | for a fully-unassessed fixture, zero `ACTION REQUIRED` rows are produced |

### Action plan

| ID | Requirement | PASS condition |
|---|---|---|
| CR-21 | Do Now / Do Next / Later grouping deterministic | same model ⇒ identical grouping across repeated renders; grouping matches the documented rule |
| CR-22 | Verification method carries through | each planned action shows the finding's `verificationMethod` |
| CR-23 | No invented result/ROI claim | forbidden claim patterns (`%` uplift, revenue, guarantee) absent from the plan |

### Language

| ID | Requirement | PASS condition |
|---|---|---|
| CR-24 | Supplied `primaryGoal` phrases render grammatically | `generate qualified enquiries`, `book consultations`, `increase sales`, `request a quote`, `schedule a call` all render without the broken `Toward Generate qualified enquiries` shape |
| CR-25 | No malformed concatenated recommendation headings | `"<Service> for generate qualified enquiries"` shape is not produced |

### Competitor

| ID | Requirement | PASS condition |
|---|---|---|
| CR-26 | Available evidence renders comparisons | supplied competitor evidence ⇒ per-signal comparison rows |
| CR-27 | Unavailable competitor evidence renders limitation only | no competitors ⇒ explicit limitation, no generic commentary |

---

## 5. False-PASS audit (pre-implementation)

| Question | Result |
|---|---|
| Could a test PASS with the implementation missing? | No — CR-01/03/04/07/09/12/16/17/24 all fail against the pre-change tree (new sections/classification absent; old weights present) |
| Could a test PASS on a hard-coded return? | No — expected values are computed from fixture inputs, not literals copied from the implementation |
| Is production decision logic duplicated in a test? | No — CR-01 recomputes the weighted sum from the fixture's own numbers, which is the requirement statement, not an implementation copy |
| Is authoritative state directly manipulated? | No — every render assertion runs `scoreAudit(INPUT, evidence)` → `renderReportV2(model)` |
| Is a mock replacing the proven behaviour? | No mocks. Fixtures supply evidence; all scoring/classification/rendering is production code |
| Is a counter disconnected from the dependency? | N/A — no call-count assertions in this package |
| Is structural presence accepted where behaviour is required? | No — CR-03/04 assert rank order, CR-20 asserts a computed count of zero **(see §8: the first form of CR-20 failed this question and was corrected)** |
| Does the negative path inject at the real boundary? | Yes — capability status and `_*Available` markers are the real production gates |
| Are concrete observable outcomes asserted? | Yes — rendered strings, ranks, statuses, counts, numeric equality |
| Would breaking production behaviour fail the test? | Verified by mutation challenge (§6) |

**PROOF HARNESS FALSE-PASS AUDIT: PASS**

## 6. Mutation challenge (executed, reverted)

Each mutation was applied to the real production module, the focused suite was
re-run, and the module was restored from a byte copy. Results below are the
observed run output, not predictions.

| # | Mutation | Expected | Observed (28 tests total) |
|---|---|---|---|
| M1 | Revert `calculateFindingPriority` to 0.30/0.25/0.20/0.15/0.10 | CR-01 fails | 27 pass / **1 fail — CR-01** |
| M2 | Force the foundation branch to never match | CR-03 fails | 26 pass / **2 fail — CR-03, CR-21** |
| M3 | Drop the confidence floor from the foundation rule | CR-04 fails | 27 pass / **1 fail — CR-04** |
| M4 | Render `Missing` instead of `Not Assessed` for unavailable evidence | CR-09 fails | 27 pass / **1 fail — CR-09** |
| M5 | Emit `0` instead of `Unavailable` for absent metrics | CR-12 fails | 27 pass / **1 fail — CR-12** |
| M6 | Let an unassessed candidate render `ACTION_REQUIRED` | CR-20 fails | 27 pass / **1 fail — CR-20** |
| — | Restore all modules | all pass | **28 pass / 0 fail** |

**Harness-integrity note.** The first M1 attempt used a `perl -0pi` multiline
substitution that silently failed to match, so the suite reported 28/28 and
would have been recorded as a false "mutation not detected". The mutation
driver was corrected to assert that the target string exists before writing,
and M1 was re-run — it then failed CR-01 as required. This is recorded because
a silent no-op mutation is itself a false-PASS mechanism in the proof process.

No deliberate breakage is committed. `git status` after the challenge showed
only the intended package files.

**PROOF HARNESS FREEZE: PASS**

---

## 8. Correction round 1 — exact-head audit item 26 (CR-20 false-PASS)

The independent exact-head audit of `6ce58e0d` returned **BLOCKED on item 26**.
All production-behaviour items passed; the defect was in the proof harness.

**Defect.** CR-20 asserted:

```js
checklist.filter((i) => i.status === ACTION_REQUIRED && i.assessed !== true)
```

`assessed` is *derived* from `status` in `foundation-readiness.js` `item()`
(`assessed: status === PASS || status === ACTION_REQUIRED`), so the predicate
is structurally unsatisfiable. The filter could never match, the assertion
could never fail, and the frozen CR-20 PASS condition — "for a fully-unassessed
fixture, zero ACTION REQUIRED rows are produced" — was never actually asserted.
Only the GA4 branch was behaviourally covered, which is why mutation M6 passed:
M6 mutated the GA4 branch, which a *different* assertion in the same test
caught. A regression in any non-GA4 branch would have shipped green.

This is precisely the "assertion disconnected from the production dependency"
false-PASS mechanism the standard prohibits. The audit finding is accepted in
full.

**Correction (test-strengthening + two production gates).**

1. CR-20 now asserts the frozen condition directly: the production checklist
   must yield an empty list of `ACTION_REQUIRED` ids for the unassessed
   fixture, every `NOT_ASSESSED` item must report `assessed === false` and
   name its required source, and the count of rendered ACTION-REQUIRED status
   chips must equal the model's count — with a **positive control** on an
   assessed fixture (`required > 0`) so the assertion cannot pass by simply
   never rendering anything.
2. `technicalDetailSection` link rows are now gated on crawl availability, so
   a failed/blocked crawl no longer renders `0 detected` as a measured fact.
3. `securityHeaders` returns `NOT_ASSESSED` when the capability reports
   available but no header keys were actually observed, closing a false-PASS
   path where an empty object would have rendered as "headers present".

Items 2 and 3 were raised by the audit as non-blocking minor observations.
They are corrected here because they are the same unknown-as-fact invariant
this package exists to enforce — in the opposite direction (unknown becoming
GOOD rather than BAD).

**Re-run mutation challenge (corrected harness).**

| # | Mutation | Expected | Observed |
|---|---|---|---|
| M7 | `securityHeaders` (non-GA4) emits ACTION_REQUIRED from unavailable evidence | CR-20 fails | 27 pass / **1 fail — CR-20** |
| M8 | `primaryContact` (non-GA4) emits ACTION_REQUIRED from unavailable evidence | CR-20 fails | 27 pass / **1 fail — CR-20** |
| M9 | Renderer stops emitting ACTION-REQUIRED chips (render/model divergence) | CR-20 fails | 27 pass / **1 fail — CR-20** |
| — | Restore | all pass | **28 pass / 0 fail** |

M7 and M8 are the exact regression class the original CR-20 could not detect.
M9 additionally proves the render/model consistency arm.

**PROOF HARNESS RE-FREEZE: PASS**

---

## 7. Verification record

| Check | Result |
|---|---|
| `npm run check:template` | PASS |
| `npm test` (full worker suite) | PASS |
| `npm run test:schemas` | PASS |
| `npm run test:artifacts` | PASS |
| `npm run test:lifecycle` | PASS |
| `npm run test:lifecycle:postgres` | PASS |
| `acceptance:wp2` … `acceptance:wp12`, `acceptance:provisioning` | PASS |
| Production-shaped fixture report replay | PASS |
| Provider calls | 0 |
| Live audits started | 0 |
