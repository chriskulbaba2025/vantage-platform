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

## 9. Correction round 2 — merge-audit: provider failure rendered as site outage

The independent merge audit of `75e13edb` found ONE material governance defect.
Accepted in full.

**Defect.** `foundation-readiness.js` `availability()` converted
`site.sourceStatus === "FAILED"` or `"BLOCKED"` into a client-facing
ACTION_REQUIRED site-availability defect reading *"The crawl could not retrieve
the site … Nothing downstream of availability can convert."*

Canonical `SOURCE_STATUS.FAILED` means evidence collection was attempted and
returned no usable records. The production DataForSEO adapter emits it for
`rate_limit`, `auth`, `network`, `timeout`, `internal` and `schema_validation`.
A provider failure is therefore **not** evidence that the website was
unavailable to visitors. `BLOCKED` proves the audit crawler was refused —
a crawl-access restriction, not a visitor-facing outage.

`robots()` carried the same class of overclaim: *"A robots.txt that blocks
crawlers also blocks search engines."* robots.txt rules are per-user-agent, so
a site refusing a third-party auditing crawler does not establish that
Googlebot or Bingbot are blocked.

**Decisive constraint found during correction.** `hydrateSite()`
(`evidence/decision-evidence.js:71-77`) returns only
`{sourceStatus, collectedAt, limitations}` for a non-viable status — no
`errorCategory`, no `statusCounts`, no pages — and the decision-evidence schema
has no `errorCategory` property on `site`. A failed source therefore carries
**zero** target-side observation, so it can only ever resolve to NOT_ASSESSED.

**Correction.**

1. `availability()` now emits ACTION_REQUIRED only on **target-side** evidence:
   the crawl observed HTTP responses from the site (`statusCounts` /
   `pages[].statusCode`) and **every one** was an error (≥ 400). The observed
   codes are cited in the finding.
2. FAILED / BLOCKED / UNAVAILABLE / NOT_CONNECTED all render NOT_ASSESSED,
   surfacing the collected limitation (and `errorCategory` when a model carries
   one), with `requires: target-side availability evidence`.
3. BLOCKED is described as a crawl-access restriction affecting this audit only.
4. `robots()` never claims search engines are blocked. An audit-crawler refusal
   is NOT_ASSESSED naming the directive evidence required. `robots_txt` has no
   ACTION_REQUIRED path, because no production source returns directives.
5. Detail wording avoids describing the website even in **negated** form —
   "does not establish that the site was unavailable" reads as a claim on skim.
   Strings describe the evidence, not the site.

**New focused regressions.** CR-28 (six provider failure categories →
NOT_ASSESSED), CR-29 (limitation surfaced), CR-30 (BLOCKED ≠ visitor outage),
CR-31 (robots refusal ≠ search engines blocked), CR-32 (proven target-side
outage IS still ACTION_REQUIRED), CR-33 (partial outage → PASS), CR-34
(existing PASS intact), CR-35 (no source-failure state yields any
ACTION_REQUIRED foundation — extends CR-20 beyond unavailable capabilities).

**Mutation challenge.**

| # | Mutation | Expected | Observed (36 tests) |
|---|---|---|---|
| M10 | Restore the reported defect (FAILED/BLOCKED → ACTION_REQUIRED) | fails | 32 pass / **4 fail — CR-28, CR-29, CR-30, CR-35** |
| M11 | Restore "also blocks search engines" | CR-31 fails | 35 pass / **1 fail — CR-31** |
| M12 | Remove the target-side proof path | CR-32 fails | 35 pass / **1 fail — CR-32** |
| — | Restore | all pass | **36 pass / 0 fail** |

M10 restores the exact defect the merge audit reported and the harness detects
it — the regression is genuinely proven, not merely asserted.

**PROOF HARNESS RE-FREEZE (round 2): PASS**

---

## 10. Correction round 3 — blacklist guard defeated by novel wording

The exact-head audit of `df1e2dc7` returned **BLOCKED on the harness**, not on
production behaviour. Accepted in full.

**Defect.** Round 2 enforced "wording must describe the evidence, never the
website" with two negative regexes (CR-28 line 599, CR-30 line 622). The
auditor defeated them with a mutation that keeps `NOT_ASSESSED` but rewrites
the detail to a site claim:

> "The crawl could not retrieve the site (…). The site could not be reached for
> visitors."

That matches neither `/site (is |was )?(down|unavailable|offline)|visitors
cannot/i` nor `/visitors cannot reach|site is unavailable|nothing downstream/i`
— the suite passed 36/36. A blacklist can only ban the phrasings someone
thought of; the invariant needs to hold for wording nobody has written yet.

**Correction — make the invariant structural rather than enumerated.**

Wording is now composed from governed constants exported by
`foundation-readiness.js`:

* `EVIDENCE_SCOPE_NOTE` — the single sentence that may mention the website.
* `EVIDENCE_FAILURE_CLAUSE` — per-status `lead`/`scope` clauses that name only
  the evidence or the crawl (`BLOCKED`, `FAILED`, `UNAVAILABLE`,
  `NOT_CONNECTED`, `UNKNOWN`).
* `ROBOTS_SCOPE_NOTE` — the single sentence that may name a search engine.

CR-36 and CR-37 assert the SHAPE: each failure detail must end with the
governed note, and the authored portion — the detail minus the
provider-supplied limitation in parentheses and minus the note — must contain
no `site|website|visitor|visitors|page|pages` (availability) and no
`google|bing|googlebot|bingbot|search engine` (robots). Only
provider-supplied limitation text is exempt, because it is not ours to author.

This holds for any future wording, not only for phrasings enumerated in
advance. The round-2 negative regexes are retained as defence in depth.

**Mutation challenge.**

| # | Mutation | Expected | Observed (38 tests) |
|---|---|---|---|
| M13 | **The auditor's exact defeating mutation** — site-claim wording, status still NOT_ASSESSED | fails | 37 pass / **1 fail — CR-36** |
| M14 | Drop the governed evidence-scope note | fails | 37 pass / **1 fail — CR-36** |
| M15 | Robots wording names Googlebot/Bingbot affirmatively | fails | 37 pass / **1 fail — CR-37** |
| M16 | BLOCKED clause reworded to a visitor claim | fails | 37 pass / **1 fail — CR-36** |
| — | Restore | all pass | **38 pass / 0 fail** |

M13 is the decisive result: the mutation that defeated the round-2 harness is
detected by the round-3 harness.

**Accepted non-blocking observations (recorded, not corrected).**

* `site.errorCategory` is read defensively but is unreachable in production —
  the schema has no such `site` property and `hydrateSite` does not emit it.
  The collected limitation string is what actually surfaces. Retained as a
  forward-compatible read; no behaviour depends on it.
* A site returning `429` to the crawler on every requested page resolves to
  ACTION_REQUIRED under the frozen `>= 400` criterion. Arguably crawl-access
  rather than outage. Within the frozen acceptance contract; recorded as a
  known MINOR for a future package rather than changed under correction
  discipline.

**PROOF HARNESS RE-FREEZE (round 3): PASS**

---

## 11. Correction round 4 — abandoning the blacklist for identity freeze

The exact-head audit of `e2f803ef` returned **BLOCKED** with **10 distinct
mutations** that reintroduced a false client-facing claim while the suite
stayed green. Accepted in full.

**The real finding is the pattern.** This was the third consecutive
harness-side block on the same invariant (round 2: novel phrasing; round 3:
synonyms, exempt regions, untested branches). Each round patched the blacklist
that the previous audit had defeated. A blacklist can only ban phrasings
someone anticipated, so it will lose this game indefinitely. The approach —
not the individual patterns — was wrong.

**Defeats accepted.** Claims could be smuggled into: the provider-limitation
parenthetical (exempted by the guard); `requires` and `label` (client-rendered
but unguarded); leads using synonyms outside the token list ("unreachable",
"end users", "offline for customers"); the `UNKNOWN` clause and the robots
NOT_RETURNED branch (both untested, the latter being the branch production
actually hits); text appended to the ACTION_REQUIRED detail; and the content
of `EVIDENCE_SCOPE_NOTE` / `ROBOTS_SCOPE_NOTE` themselves — the tests imported
those constants, so `endsWith(note)` proved identity, never content.

**Correction — enforce by identity, not by vocabulary.**

1. **No interpolation in audit prose.** Every failure `detail` is a fully
   composed frozen constant (`EVIDENCE_FAILURE_DETAIL`, `ROBOTS_DETAIL`).
   There is no authored region left to smuggle a claim into.
2. **Provider text is structurally quarantined.** A source limitation never
   enters audit prose; it is carried in a new `evidenceNote` field, always
   prefixed `Evidence source reported:` and rendered as an attributed quote.
   A future adapter string making a visitor claim therefore cannot be read as
   an audit finding. This closes the parenthetical exemption permanently.
3. **Tests assert exact equality against literals declared in the test**, not
   imported from the module — freezing content, not just identity — across
   every failure branch and every client-rendered field (`label`, `detail`,
   `requires`, `evidenceNote`).
4. **Coverage extended to every branch**: `NOT_APPLICABLE`, absent status, and
   all three robots branches including `NOT_RETURNED` (the production path).
5. **CR-39 sweeps every item of every fixture** for site-behaviour claims in
   any client-rendered field, permitting them only inside the two frozen
   governed sentences.

**Mutation challenge — all ten prior defeats re-run.**

| # | Mutation that previously stayed green | Now |
|---|---|---|
| M-A2 | Claim inside the provider parenthetical | **3 fail** |
| M-B | Claim in `requires` | **2 fail** |
| M-C | Claim in `label` | **2 fail** |
| M-D | BLOCKED lead, synonym tokens | **3 fail** |
| M-D2 | FAILED lead, synonym tokens | **4 fail** |
| M-G | `UNKNOWN` clause claim | **2 fail** |
| M-H | robots production-default branch | **2 fail** |
| M-J | Mutate `EVIDENCE_SCOPE_NOTE` content | **4 fail** |
| M-K | Mutate `ROBOTS_SCOPE_NOTE` to affirmative | **2 fail** |
| M-F | Append claim to ACTION_REQUIRED detail | **1 fail** |
| — | Restore | **41 pass / 0 fail** |

**Claim-accuracy correction (audit item 6).** The round-3 commit message
stated the change was a pure composition refactor with "rendered strings
unchanged for every existing state". That was false: `UNAVAILABLE`,
`NOT_CONNECTED`, `NOT_APPLICABLE` and absent-status previously fell through to
a generic "Site retrieval status was not recorded for this audit." and now
receive dedicated evidence-scoped wording. Status semantics were unchanged
(`NOT_ASSESSED` throughout) and the new wording is more accurate — for an
`UNAVAILABLE` source the status *was* recorded — but the claim was overstated
and is corrected here. The durable record never contained it; only the commit
message did.

**PROOF HARNESS RE-FREEZE (round 4): PASS**

---

## 12. Correction round 5 — the freeze was scoped; the invariant is global

The exact-head audit of `2e28469b` confirmed all ten round-4 defeats were
caught, then defeated the guard with **8 new mutations**. Accepted in full.

**Why it kept failing.** Rounds 2, 3 and 4 each froze exactly the wording the
previous audit had attacked. The next audit simply attacked a different item
or a different layer. The invariant stated at the top of
`foundation-readiness.js` is global — *no* checklist item may describe website
behaviour without target-side evidence — but the round-4 freeze covered only
`site_availability` and `robots_txt`, two of fourteen candidates, and every
assertion in the suite was model-level, leaving the renderer unguarded.

**Defeats accepted.**

| Class | Example |
|---|---|
| Unfrozen candidates | `indexability`, `https`, `conversion_measurement` details carried inline claims (N3, N4, N5) |
| Strip exploit | CR-39 blanket-stripped the outage sentence, so *any* item could carry it (N6) |
| Re-interpolation | provider text re-entered the ACTION_REQUIRED outage prose (N7) |
| Render layer | the renderer could append a claim to every row, add one to the summary, or drop the attribution prefix — no test read rendered HTML (N1, N8, N2) |

**Correction — enforce globally, at both layers.**

1. **CR-40 — whole-checklist golden freeze.** A SHA-256 fingerprint of the
   complete checklist (all 14 candidates × `label`, `status`, `detail`,
   `requires`, `evidenceNote`, `assessed`, `foundational`) is frozen for a
   7-fixture matrix covering every reachable branch: assessed, unassessed,
   provider-failed, crawl-blocked, target-outage, http-and-noindex,
   robots-retrieved. Any wording or status change anywhere in any item fails
   until reviewed and re-frozen. Fingerprints are compared as a whole so one
   run reports every drift.
2. **CR-41 — render fidelity.** For every fixture, each item's `label`,
   `detail`, `requires` and `evidenceNote` must appear verbatim (HTML-escaped)
   in the rendered foundation section, `evidenceNote` must still carry the
   attribution prefix at render time, and the section must contain no
   site-behaviour claim beyond the governed model text.
3. **CR-39 strip exploit closed.** The target-side outage sentence is now
   permitted only on `site_availability` when its status is `ACTION_REQUIRED`.

The frozen wording was reviewed before the fingerprints were accepted: across
the whole matrix the only site-behaviour claim is on the `target-outage`
fixture, where every crawled page returned HTTP 503.

**Mutation challenge — all 8 new defeats, plus prior-round spot checks.**

| # | Mutation | Round-4 result | Round-5 result |
|---|---|---|---|
| N6 | Outage sentence smuggled onto `indexability` | green | **2 fail** |
| N3 | `indexability` claim, synonym-free phrasing | green | **2 fail** |
| N4 | `https` ACTION_REQUIRED branch claim | green | **2 fail** |
| N5 | `conversion_measurement` claim | green | **2 fail** |
| N7 | Provider text re-interpolated into outage prose | green | **1 fail** |
| N1 | Renderer appends a claim to every row | green | **1 fail** |
| N2 | Renderer drops the attribution prefix | green | **1 fail** |
| N8 | Renderer summary-paragraph claim | green | **1 fail** |
| M-B | Claim in `requires` (round-4 regression check) | 2 fail | **4 fail** |
| M-J | `EVIDENCE_SCOPE_NOTE` content (round-4 regression check) | 4 fail | **6 fail** |
| M-H | robots `NOT_RETURNED` branch (round-4 regression check) | 2 fail | **3 fail** |
| — | Restore | — | **43 pass / 0 fail** |

**PROOF HARNESS RE-FREEZE (round 5): PASS**

---

## 13. Correction round 6 — terminal guard: branch completeness + full-render freeze

The exact-head audit of `fe1d3c66` confirmed all 8 round-5 defeats were caught,
then defeated the guard with **10 new mutations**. Accepted in full. One of
them (`conversion_measurement` NOT_APPLICABLE) stayed green across the entire
854-test worker suite while rendering a false claim to the client.

**Diagnosis — five rounds of the same mistake.** Rounds 2–5 each extended the
guard to cover the branches the previous audit had attacked. Each time, the
next audit moved to a branch or layer that was not enumerated. The guard was
always *enumeration-shaped*: a list of banned phrases, then a list of frozen
fields, then a list of fixtures. Enumeration loses to an adversary who picks
the item you did not list. Measured directly: the round-5 matrix reached only
**16 of the 35** (item, status) pairs the checklist can produce, so 19 branches
were free space.

**Correction — stop enumerating; make the guard total.**

1. **CR-42 — branch completeness, proven.** `REACHABLE_BRANCHES` declares all
   35 (item, status) pairs the implementation can produce, and CR-42 asserts
   the fixture matrix reaches **exactly** that set. The matrix grew from 7 to
   17 fixtures to satisfy it. A new branch that no fixture reaches now fails
   here instead of silently escaping every freeze.
2. **CR-43 — full rendered-report freeze.** A SHA-256 of the **entire rendered
   document** is frozen per fixture. Any change to any rendered byte — model
   wording, status-chip label, renderer template, summary line, action plan,
   strengths — fails regardless of phrasing. There is nothing to enumerate and
   no novel wording that can evade it. This is the same golden-artifact
   technique the repository already applies to the v1 report (V2R-07).
3. **CR-39 sharpened to the real rule.** An item whose `assessed !== true` may
   make no site-behaviour claim at all. An **assessed** item may, because
   evidence was collected to support it — and its exact wording is frozen by
   CR-40/CR-43 rather than policed by a pattern. This removes the last
   blacklist from the suite.

**Mutation challenge — all 10 new defeats.**

| # | Mutation | Round-5 | Round-6 |
|---|---|---|---|
| M-NEW-1 | ga4 NOT_APPLICABLE claim (was green across all 854 tests) | green | **2 fail** |
| M-NEW-2 | ga4 AVAILABLE+issues claim | green | **2 fail** |
| M-NEW-3 | `conversion_mechanism` ACTION_REQUIRED claim | green | **2 fail** |
| M-NEW-4 | `primary_contact` ACTION_REQUIRED claim | green | **2 fail** |
| M-NEW-5 | `canonical` ACTION_REQUIRED claim | green | **3 fail** |
| M-NEW-6 | `mobile_experience` ACTION_REQUIRED claim | green | **2 fail** |
| M-NEW-7 | Renderer, novel phrasing | green | **1 fail** |
| M-NEW-8 | Status-chip label (satisfies the checklist hash) | green | **1 fail** |
| M-NEW-9 | Conditional re-interpolation into outage prose | green | **2 fail** |
| M-NEW-10 | `actionPlanSection` claim | green | **1 fail** |
| — | Restore | — | **45 pass / 0 fail** |

**Newly-covered wording reviewed before freezing.** The six ACTION_REQUIRED
branches the matrix now reaches were read individually. Two make visitor
claims — `conversion_mechanism` ("Visitors have no clear way to convert") and
`primary_contact` ("Visitors ready to act have no direct way to reach the
business") — and both are legitimate: each is gated on its capability being
AVAILABLE, so the absence was assessed, not assumed. The rest cite observed
counts or scores.

**Residual limitation (recorded).** CR-42 compares the matrix against a
*declared* branch list. Adding a branch to the implementation requires adding
it to `REACHABLE_BRANCHES` and supplying a fixture; the declaration is
maintained by review. CR-43 bounds the blast radius: any new branch that
changes rendered output for an existing fixture still fails.

**PROOF HARNESS RE-FREEZE (round 6): PASS**

---

## 14. Correction round 7 — widening the freeze to every claim-bearing section

The exact-head audit of `7f0c650e` confirmed all 10 round-6 defeats were
caught, the branch declaration was empirically complete, and all 34
fingerprints regenerated — then defeated the guard with **7 new mutations**,
each green across the full 854-test suite and each production-reachable.

**Provenance matters here.** Six of the seven live in code this package added
(Section E's foundation-blocker row, the competitor note, the CMS
migration-risk line, the confirmed-absent schema branch, the heading branches,
the failed-device branch); one is pre-existing (untraced broken links, PR #57).
They are in scope: this package introduced client-facing prose that the
no-fabrication proof did not cover.

**Diagnosis.** CR-43 hashes the full render, but only for the evidence shapes
the matrix carries — and the round-6 matrix carried only *foundation* shapes.
Measured directly: of eight prose-bearing renderer branches outside the
checklist, **zero** were reached by any of the 17 fixtures. The freeze was
total in depth and narrow in breadth.

**Correction.**

1. **Matrix widened from 17 to 25 fixtures**, adding the evidence shapes that
   trigger every claim-bearing renderer branch: browser path-validation
   evidence (Section E blocker row), SERP competitor evidence, a proprietary
   platform, untraced broken links, confirmed-absent schema, absent-H1 and
   multiple-H1 heading variants, and a FAILED device profile.
2. **CR-44 — renderer-branch coverage, proven.** Asserts that some fixture
   reaches each claim-bearing branch, identified by a marker string unique to
   it. A branch that no fixture reaches now fails here rather than sitting
   unfrozen. This is the render-layer analogue of CR-42.
3. All 25 fixtures are frozen by both CR-40 (checklist) and CR-43 (full render).

**Mutation challenge — all 7 new defeats.**

| # | Mutation | Round-6 | Round-7 |
|---|---|---|---|
| N-D | Section E blocker row: "visitors cannot complete any purchase" | green | **1 fail** |
| N-E | Untraced broken links: invented abandonment consequence | green | **1 fail** |
| N-F | Competitor note replaced with a fabricated traffic claim | green | **2 fail** |
| N-K | CMS migration risk: invented abandonment statistic | green | **1 fail** |
| N-M | Heading branch: "visitors cannot navigate the site" | green | **1 fail** |
| N-G | Schema branch: "The site is invisible to AI search" | green | **1 fail** |
| N-H | Device FAILED branch: asserts a positive site fact from failed evidence | green | **1 fail** |
| — | Restore | — | **46 pass / 0 fail** |

**Accepted non-blocking observations from the round-6 audit.** Three green
mutations were confirmed *not* production-reachable and are recorded rather
than fixed: the `security_headers` empty-object branch (both adapters always
emit the four keys), the GA4 issue-count fallback (all six issue types carry
`detail`), and a hand-added `mobile_experience:NOT_APPLICABLE` branch (the
PageSpeed client never emits that status). The last is the recorded CR-42
residual limitation — the branch declaration is review-maintained.

**PROOF HARNESS RE-FREEZE (round 7): PASS**

---

## 15. Correction round 8 — in-scope fixes, and a governed scope boundary

The exact-head audit of `42d67d68` confirmed all 7 round-7 defeats were caught,
then defeated the guard with **10 new mutations**, all production-reachable.

**Provenance was checked before acting**, by testing each flagged string
against this package's own diff (`git diff 9e0006ac..HEAD`):

| Finding | Location | Authored by this package? |
|---|---|---|
| NEW-5 CrUX field-data note | `report-detail-sections.js` | **YES** |
| NEW-6 multi-page tested-pages block | `report-detail-sections.js` | **YES** |
| NEW-9 competitor limitations block | `render-report-v2.js` | **YES** |
| NEW-1 internal-link opportunities note | `render-report-v2.js` | no — pre-existing |
| NEW-2 orphan heading | `render-report-v2.js` | no — pre-existing |
| NEW-3 crawl-incomplete note | `render-report-v2.js` | no — pre-existing |
| NEW-4 traced broken-links block | `render-report-v2.js` | no — pre-existing (PR #57) |
| NEW-7 GSC source-status line | `render-report-v2.js` | no — pre-existing |
| NEW-8 AUTH_WALL diagnostic text | `diagnostic-contracts.js` | no — file untouched |
| NEW-10 VAN-GSC-001 businessImpact | `score-components.js` | no — this package's only change to that file is `calculateFindingPriority` |

**Corrected (in scope, 3 of 10).** Two fixtures added — CrUX field data with
multi-page results, and competitor evidence carrying an opportunity-layer
limitation — plus three new `RENDERER_BRANCH_MARKERS` entries. Matrix is now
27 fixtures; all frozen by CR-40 and CR-43.

| # | Mutation | Round-7 | Round-8 |
|---|---|---|---|
| NEW-5 | CrUX note asserts a competitor comparison | green | **1 fail** |
| NEW-6 | Multi-page block invents a threshold failure | green | **1 fail** |
| NEW-9 | Competitor limitations block asserts superiority | green | **1 fail** |
| — | Restore | — | **46 pass / 0 fail** |

**NOT corrected — governed stop (7 of 10).** The remaining findings are in code
this package did not author: the internal-links section, the GSC source-status
line, the diagnostic-contract client explanations (~22 codes), and finding
`businessImpact` strings. Closing them means freezing prose across the whole
report surface and the diagnostic/finding catalogues — a materially larger
work package touching modules outside this change.

Governed Build Standard §3.2 (expansion beyond the authorized work-package
boundary) and §3.8 (audit remains BLOCKED after governed correction attempts)
both apply. Continuing autonomously would silently convert a report-improvement
package into a whole-product wording-freeze programme. **Escalated for
authorization instead.**

**What the audits established about this package's own scope.** The originally
reported defect — provider/evidence failure rendered as a website outage — was
corrected in round 2 and has survived six subsequent adversarial audits
unchanged. Every audit from round 2 onward reported the production behaviour
correct; every block since has been harness coverage, and the last two found
defeats only in prose reachable through increasingly specific evidence shapes.

**PROOF HARNESS FREEZE (round 8, in-scope): PASS**
**OUT-OF-SCOPE FINDINGS: ESCALATED, NOT MERGED**

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
