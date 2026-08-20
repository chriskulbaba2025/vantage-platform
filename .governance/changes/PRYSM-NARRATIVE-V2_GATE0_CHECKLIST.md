# PRYSM-NARRATIVE-V2 — Gate 0 Frozen Checklist

Change ID: `PRYSM-NARRATIVE-V2-G0`
Version: `1.0.0`
Change class: governed report/narrative foundation
Release intent: no production release; additive contract/proof only
Terminal outcome: exact source-native/canonical terminology boundary is frozen and regression-proven before Writer/Judge production wiring begins
Branch: `fix/prysm-narrative-lineage-v2`
PR: `#60` (draft)
Starting SHA: `ea5e0a26b39a395874addc1ef3488d50bb16f5d3`

## Objective

Eliminate the historical class of report defects where valid evidence or scores disappear because downstream code guesses aliases, reconstructs business context, or defaults missing evidence into a present value.

## Production spine under audit

`provider payload -> production adapter normalization -> DecisionEvidence / ScoreSet / FindingSet / persisted AuditRequest -> future Writer v2 -> future Judge v2 -> future v2 report`

Gate 0 changes only the future narrative-v2 boundary. It must not alter the active production spine.

## Protected invariants

- current provider calls and adapter execution behavior unchanged;
- current scoring rules and numeric outputs unchanged;
- current lifecycle transitions unchanged;
- current v1 and v2 render output unchanged;
- current production narrative execution unchanged;
- unknown/unavailable evidence never becomes absence by default;
- LLM never becomes source of observed facts or scores;
- no paid provider or LLM calls in Gate 0 acceptance;
- no merge/deploy authorized by Gate 0 completion.

## Permitted files

- `.governance/changes/PRYSM-NARRATIVE-V2_*`
- `services/worker/src/narrative-v2/*`

## Prohibited files for Gate 0

- production adapters;
- scoring/rules;
- lifecycle/orchestrator;
- active narrative service;
- active report renderers;
- storage/database;
- web application;
- deployment/runtime configuration.

---

## G0-01 — DataForSEO On-Page exact terminology

Requirement: Register each report-critical DataForSEO On-Page source field by its exact production payload path and map it once to one exact canonical field.

Production boundary: DataForSEO On-Page adapter normalization.

Positive proof: registry resolves exact tuples such as `meta.canonical -> site.pages[].canonicalUrl` and `meta.description -> site.pages[].metaDescription`.

Negative proof: compatibility fallback names such as `canonical` and invented names such as `meta_description` do not resolve downstream.

Acceptance proof: `source-field-registry.test.js` exact-name assertions.

Fault injection: request an unregistered alias.

Recovery proof: fails closed with `Unregistered source lineage` / `Unregistered canonical field`.

Protected invariant: production adapter unchanged.

Failure result: BLOCK Gate 0.

Status: [x]

## G0-02 — DataForSEO SERP exact terminology

Requirement: Register report-critical DataForSEO SERP source fields using exact provider names before normalization.

Production boundary: `dataforseo-serp-client.js` normalization.

Positive proof: `url`, `domain`, `title`, `rank_absolute`, `featured_snippet` map to stable canonical competitor evidence fields.

Negative proof: `rank_group` is recorded only as the existing adapter fallback and cannot be referenced as a downstream alias.

Acceptance proof: `LINEAGE-DFS-07/08`.

Fault injection: downstream reference using `rank_group`.

Recovery proof: tuple does not resolve.

Protected invariant: SERP execution and competitor crawling unchanged.

Failure result: BLOCK Gate 0.

Status: [x]

## G0-03 — DataForSEO Backlinks exact terminology

Requirement: Register report-critical backlink record and summary fields by exact DataForSEO names.

Production boundary: `backlinks-provider.js` normalization.

Positive proof: exact fields include `domain_from`, `page_from`, `page_to`, `anchor`, `semantic_location`, `domain_from_rank`, `backlinks_spam_score`, `referring_domains`, `referring_pages`, `target_spam_score`.

Negative proof: provider fallback `spam_score` cannot be used downstream in place of `backlinks_spam_score`.

Acceptance proof: `LINEAGE-DFS-09/10`.

Fault injection: downstream `spam_score` reference.

Recovery proof: tuple does not resolve.

Protected invariant: backlink provider execution and quality classification unchanged.

Failure result: BLOCK Gate 0.

Status: [x]

## G0-04 — Persisted business context survives exactly

Requirement: Future Writer context copies `businessName`, `targetUrl`, `primaryGoal`, `market`, `language`, `services`, and `competitors` from the persisted governed request without reconstruction or defaults.

Production boundary: future Writer input builder.

Positive proof: exact values survive byte-for-value semantics for strings and item-for-item arrays.

Negative proof: absent optional context remains absent; `en-CA`, blank market, or blank primary goal are not injected.

Acceptance proof: `writer-business-context.test.js`.

Fault injection: omit market/language/primaryGoal.

Recovery proof: fields remain absent rather than fabricated.

Protected invariant: current audit request schema unchanged.

Failure result: BLOCK Gate 0.

Status: [x]

## G0-05 — ScoreSet keys survive exactly

Requirement: Future Writer/Judge score context uses only exact canonical ScoreSet names.

Production boundary: future Writer score projection.

Positive proof: all current canonical keys survive, including `scores.trustEeatDimension`, `scores.contentFunnelDimension`, `scores.conversionPathwaysDimension`, `scores.technicalPerformanceDimension`, and `scores.entitySchemaAiDimension`.

Negative proof: aliases such as `eeatScore`, `trustEeat`, or `contentFunnelScore` cannot substitute.

Acceptance proof: `writer-scores.test.js`.

Fault injection: provide only aliases.

Recovery proof: aliases are omitted; missing canonical keys remain missing.

Protected invariant: deterministic scoring unchanged.

Failure result: BLOCK Gate 0.

Status: [x]

## G0-06 — FindingSet uses canonical fields only

Requirement: Future Writer projection consumes canonical Finding fields and evidence keys only.

Production boundary: future Writer finding projection.

Positive proof: `title`, `businessImpact`, `recommendation`, `implementationEffort`, and evidence `field` / `observedValue` survive unchanged.

Negative proof: renderer-compatibility aliases `problem`, `impact`, `fix`, and `effort` cannot substitute for canonical fields.

Acceptance proof: `writer-findings.test.js`.

Fault injection: delete a canonical field while providing its alias.

Recovery proof: projection fails closed naming the missing canonical field.

Protected invariant: existing Finding schema and active renderer compatibility remain unchanged.

Failure result: BLOCK Gate 0.

Status: [x]

## G0-07 — Historical report regression audit

Requirement: Assess Karen Leslie and historical GPT/n8n report artifacts for report-depth requirements and known data-loss patterns.

Production boundary: design/regression only.

Positive proof: `PRYSM-NARRATIVE-V2_REPORT_REGRESSION.md` records required report jobs and exact-field regression examples.

Negative proof: old alias/default behavior is explicitly rejected rather than copied forward.

Acceptance proof: documented historical examples include source-status aliases, technical zero defaults, business-context reconstruction, and score-field loss risk.

Fault injection: n/a — documentary regression source.

Recovery proof: future Writer/Judge acceptance must reference this regression matrix.

Protected invariant: historical artifacts are reference evidence only; no old code is reintroduced.

Failure result: BLOCK production Writer/Judge wiring.

Status: [x]

## G0-08 — Active production behavior remains untouched

Requirement: Gate 0 must be additive only.

Production boundary: repository diff.

Positive proof: exact PR #60 changed-file audit at head before CI found 11 files, all confined to `.governance/changes/PRYSM-NARRATIVE-V2_*` and new `services/worker/src/narrative-v2/*` paths. No active orchestrator, adapter, scoring, narrative-service, renderer, storage, web, or runtime file is changed.

Negative proof: no active production file imports `narrative-v2` because no active production file is modified by the PR.

Acceptance proof: `list_pr_changed_filenames(PR #60)` returned only the 11 permitted files.

Fault injection: any edit to a prohibited file or active runtime import.

Recovery proof: revert out-of-scope change before Gate 0 acceptance.

Protected invariant: deployed output identical to current production main.

Failure result: BLOCK Gate 0.

Status: [x] exact diff scope PASS; final exact-head CI still required by G0-09

## G0-09 — Full regression

Requirement: Mandatory worker CI succeeds at exact PR head.

Production boundary: repository CI.

Positive proof: `Vantage Worker CI` SUCCESS with `head_sha` equal to final Gate 0 head.

Negative proof: no acceptance based on a previous commit or partial workflow.

Acceptance proof: exact workflow run ID + head SHA recorded before closure.

Fault injection: n/a.

Recovery proof: any failure is diagnosed and corrected before closure.

Protected invariant: no paid provider/LLM calls in normal CI.

Failure result: Gate 0 remains OPEN.

Status: [ ] pending

## Gate 0 terminal rule

Gate 0 may be declared complete only when G0-08 and G0-09 pass at the exact final head. Completion still does **not** authorize merge, deploy, or a live paid audit.