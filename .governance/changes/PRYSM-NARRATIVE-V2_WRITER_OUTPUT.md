# PRYSM Narrative v2 — Writer Output + Prompt Contract

Change ID: `PRYSM-NARRATIVE-V2-WRITER-OUT`
Version: `1.0.0`
Change class: additive governed narrative contract
Base dependency: `fix/prysm-judge-v2-contract` / PR #62
Production activation: **not authorized by this change**

## Objective

Freeze the structured report object that the governed Writer may create and the fixed prompt rules used on Pass 1, Pass 2 and Pass 3.

The Writer interprets deterministic evidence. It does not decide what was observed, alter scores, alter source status, invent provider data, or create new URLs.

## Authority chain

`provider source field -> governed lineage boundary -> canonical deterministic artifacts -> WriterInput.referenceIndex -> WriterOutput evidenceRefs -> Judge -> report renderer`

For DataForSEO-derived evidence, the exact provider source terminology remains governed by `source-field-registry.js`; downstream prose may never guess a similar source field or invent an alias. Production wiring must preserve that lineage and may not bypass the registry.

## Writer statement classes

Writer output is limited to:

- `INTERPRETATION` — business meaning derived from governed evidence;
- `OPPORTUNITY` — proposed future action/content derived from governed evidence.

There is deliberately no Writer `OBSERVED` class. Observations belong to deterministic evidence/findings upstream.

## Required report sections

1. Executive conclusion
2. Strengths to preserve
3. Root-cause interpretation
4. Conversion
5. Content and topical architecture
6. Funnel opportunities — awareness / consideration / decision, maximum 3 each
7. SEO / SERP
8. AISEO / AEO / GEO (`aiSearch`)
9. E-E-A-T / Trust
10. Technical foundations
11. Performance / UX
12. Competitors
13. Limitations explained in client language
14. Prioritized action plan — maximum 5
15. Executive decision — Preserve / Change / Do Next

## Evidence lineage rule

Every substantive narrative atom has:

```json
{
  "text": "...",
  "statementClass": "INTERPRETATION | OPPORTUNITY",
  "evidenceRefs": ["exact WriterInput.referenceIndex id"]
}
```

Unknown references fail deterministic validation. Empty evidence references fail deterministic validation.

## Data-name rule

The Writer is prohibited from:

- guessing source field names;
- using renderer compatibility aliases;
- rebuilding a value under a friendlier machine name;
- substituting a similar field when an exact field/reference is absent;
- treating an absent optional field as an empty/default value.

Human-facing headings can be plain language. Machine lineage remains exact.

## Pass 1

The Writer receives only the governed WriterInput packet.

It creates the complete WriterOutput object once.

The prompt explicitly requires:

- answer-first executive interpretation;
- evidence-backed strengths;
- one coherent root cause where supported;
- substantial content, conversion and E-E-A-T treatment;
- non-technical explanation of technical evidence;
- limitations that explain what must not be inferred;
- bounded, business-specific funnel ideas;
- no HTML, Markdown, or generated URLs.

## Pass 2 / Pass 3

These are surgical correction passes, not fresh generations.

Inputs:

- same WriterInput;
- previous validated WriterOutput;
- Judge defects;
- Judge `revisionDirective`.

Only `revisionDirective.fieldsToRewrite` may change. All other governed report sections are compared deterministically against the prior pass. Collateral rewrites fail validation.

No Pass 2/3 can start from a Judge `PASS` or `HUMAN_REVIEW_REQUIRED` decision.

## Bounded content rules

- strengths: 1–5;
- awareness ideas: 0–3;
- consideration ideas: 0–3;
- decision ideas: 0–3;
- limitations: 0–10;
- action plan: 1–5;
- narrative atoms have governed word ceilings;
- URLs are rendered from deterministic data, never authored inside Writer prose.

If evidence cannot support three funnel ideas, fewer are required. The contract prefers truthful incompleteness over generic filler.

## Acceptance tests

- `WRITER-OUT-01` complete governed output validates;
- `WRITER-OUT-02` unknown evidence reference fails closed;
- `WRITER-OUT-03` Writer cannot emit `OBSERVED` statements;
- `WRITER-OUT-04` generated URLs/HTML fail closed;
- `WRITER-OUT-05` funnel ideas are bounded to three per stage;
- `WRITER-OUT-06` targeted Pass 2 can modify an authorized section;
- `WRITER-OUT-07` collateral rewrite fails closed;
- `WRITER-PROMPT-01` Pass 1 prompt freezes canonical terminology/evidence authority;
- `WRITER-PROMPT-02` revision prompt carries exact Judge defect/directive;
- `WRITER-PROMPT-03` Pass 2 cannot run without a governed `REVISE` decision.

## Protected invariants

This change must not modify:

- active narrative service;
- production prompt template;
- provider adapters;
- deterministic scoring;
- finding generation;
- lifecycle/orchestrator;
- v1/v2 renderer;
- storage/database;
- deployment configuration.

No provider or LLM call is introduced by this contract.

## Terminal rule

This contract may proceed to production wiring only after the stacked lineage, WriterInput, Judge and WriterOutput heads have exact-head CI proof and the production wiring is separately audited against historical reports and persisted evidence. Passing this contract alone does not authorize merge, deployment, or a paid production audit.
