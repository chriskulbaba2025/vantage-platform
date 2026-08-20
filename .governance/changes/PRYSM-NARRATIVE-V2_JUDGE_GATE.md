# PRYSM Narrative v2 — Judge / Three-Pass Governance Gate

Change ID: `PRYSM-NARRATIVE-V2-JUDGE`
Version: `1.0.0`
Change class: additive narrative-governance contract
Production effect: none until separately wired and authorized

## Objective

Measure every generated report against a frozen 100-point rubric, require perfect evidence fidelity, allow at most two targeted correction passes after the initial draft, and fail to human review after Pass 3 rather than generating indefinitely.

## Governed sequence

`Writer Pass 1 -> hard gate -> Judge -> targeted Pass 2 if required -> hard gate -> Judge -> targeted Pass 3 if required -> hard gate -> Judge -> RELEASE_CANDIDATE or HUMAN_REVIEW_REQUIRED`

There is no Pass 4.

## Hard evidence gate

Any governed hard-gate violation blocks release regardless of rubric score:

- `UNSUPPORTED_FACT`
- `INVENTED_METRIC`
- `INVENTED_URL`
- `SCORE_MUTATION`
- `SOURCE_STATUS_MUTATION`
- `UNAVAILABLE_AS_ABSENT`
- `CONTRADICTS_FINDING`
- `UNSUPPORTED_COMPETITOR_CLAIM`
- `OBSERVATION_WITHOUT_EVIDENCE`
- `UNAUTHORIZED_EVIDENCE`
- `MISSING_REQUIRED_SECTION`

All Judge evidence references must resolve against the exact `WriterInput.referenceIndex`; unresolved references fail closed.

## Frozen rubric — 100 points

| Criterion | Weight |
|---|---:|
| Evidence fidelity | 20 |
| Business relevance | 10 |
| Executive clarity | 10 |
| Root-cause coherence | 10 |
| Actionability / prioritization | 10 |
| Conversion interpretation | 8 |
| Content / funnel depth | 8 |
| E-E-A-T / trust | 6 |
| SEO / technical interpretation | 6 |
| Competitive usefulness | 4 |
| Strengths / balanced assessment | 4 |
| Non-repetition / structure | 4 |
| **Total** | **100** |

## Release rule

A report is `PASS` only when all conditions are true:

1. total score is at least `92/100`;
2. evidence fidelity is exactly `20/20`;
3. there are zero hard-gate violations;
4. no rubric dimension is below 70% of its available points;
5. no `MAJOR` defect remains.

Otherwise Pass 1 or Pass 2 returns `REVISE`. Pass 3 failure returns `HUMAN_REVIEW_REQUIRED`.

## Surgical rewrite rule

The Judge does not rewrite prose. Each defect must state:

- exact rubric criterion;
- affected report section;
- severity;
- problem;
- why it matters;
- governed evidence references;
- exact required correction;
- exact Writer fields allowed to change;
- Writer fields that must be preserved.

For an automatic revision, `revisionDirective.fieldsToRewrite` must exactly match the union of the defect-authorized Writer fields. Passed sections are not reopened casually.

## Governed Writer section names

- `executiveConclusion`
- `strengths`
- `rootCause`
- `conversion`
- `content`
- `funnelOpportunities.awareness`
- `funnelOpportunities.consideration`
- `funnelOpportunities.decision`
- `seoSerp`
- `aiSearch`
- `eeatTrust`
- `technical`
- `performanceUx`
- `competitors`
- `limitations`
- `actionPlan`
- `executiveDecision`

## Protected invariants

- Judge cannot create observed facts.
- Judge cannot change deterministic scores.
- Judge cannot change evidence/source status.
- Judge cannot authorize unregistered evidence references.
- Judge cannot request an automatic fourth pass.
- No provider or LLM call is added by this contract-only change.
- No current production narrative, scoring, renderer, lifecycle, database, or provider file is modified.

## Acceptance

`judge-contract.test.js` proves:

- rubric totals exactly 100;
- release on a valid passing response;
- evidence fidelity below 20 blocks release even above 92 total;
- hard-gate violations block release even at 100 total;
- unknown evidence references fail closed;
- targeted revision cannot expand beyond defect-authorized sections;
- Pass 3 failure routes to human review;
- Judge cannot falsify total score;
- unknown hard-gate codes fail closed;
- a weak dimension cannot hide behind a high average.

This contract remains stacked behind the Writer v2 input boundary and must not be merged or production-wired until its dependencies have exact-head CI proof and governed authorization.
