# PRYSM Narrative v2 — Historical Report Regression Audit

Status: FROZEN REGRESSION INPUT
Base production SHA: `ea5e0a26b39a395874addc1ef3488d50bb16f5d3`

## Purpose

Use previous PRYSM/Karen Leslie report artifacts as regression evidence while Narrative v2 is built. The objective is not to reproduce old code. It is to preserve useful report depth while permanently removing the historical alias/default patterns that caused valid data to disappear or be misrepresented.

## Historical references reviewed

1. Karen Leslie Stress Recovery Solutions report (`index.html`, July 19, 2026; historical file-library artifact).
2. Earlier Karen Leslie report (`index (4).html`, June 25, 2026; historical file-library artifact).
3. Historical n8n/GPT report payload generators including `Pryzm_GPT_Client_Report_Generator_COMPLETE_v2.json` through later variants.
4. Current production contracts and renderer at base SHA `ea5e0a26...`.

## Confirmed historical failure patterns

### HR-01 — alias chains hid contract drift

Historical payload generators accepted chains such as:

- `site.sourceStatus ?? site.status`
- `performance.sourceStatus ?? performance.status`
- `site.pageCount ?? site.coverage?.returnedRecordCount ?? site.coverage?.completed ?? 0`
- technical counters from either top-level fields or `website.metrics.*`

This made a malformed producer look compatible and allowed the report to continue with a substitute name rather than fail at the broken boundary.

**Narrative v2 rule:** aliases are prohibited after the one provider-normalization boundary. A missing canonical field fails validation or is explicitly unavailable.

### HR-02 — unknown evidence was silently converted to zero/empty

Historical payload code defaulted missing technical values and coverage counters to `0`, empty arrays, and empty strings. That can convert "not collected" into "none found".

**Narrative v2 rule:** missing/unknown remains missing/unknown unless an explicit capability state proves the field was assessed.

### HR-03 — score-field loss was possible despite the score existing

A historical GPT payload generator contained score-preservation logic around `trustEeatDimension` that could delete the field after building the output. This is a direct example of report data being lost after deterministic scoring.

**Narrative v2 regression:** when `scores.trustEeatDimension` exists, the Writer input, Judge input, and final report model must retain that exact canonical score key and value. No alternate score name may satisfy the test.

### HR-04 — business context was useful in the report but is not reliably preserved by the current package path

The Karen Leslie report displayed location/market and `en-CA`, and used business/site context to explain limitations. Current v1 package/view-model code can drop market/primaryGoal and reconstruct language.

**Narrative v2 regression:** persisted `businessName`, `targetUrl`, `primaryGoal`, `market`, `language`, `services`, and `competitors` must be copied exactly into Writer input. Missing optional values must not be invented.

## Karen Leslie report depth that must survive

The historical report is a presentation/depth reference, not a source of current audit facts. Narrative v2 must retain the useful reporting jobs below when evidence supports them:

| Report job | Historical reference behavior | Narrative v2 requirement |
|---|---|---|
| Executive conclusion | Explains the site in business context before detail | Required |
| Evidence confidence | Explains strengths and limitations in plain language | Required |
| Root cause | Connects findings into one coherent constraint | Required |
| Funnel readiness | Awareness / consideration / decision interpretation | Required |
| Content ideas | Buyer-stage content recommendations | Required; max 3 per stage |
| Competitor benchmark | Explicitly bounded to collected competitor evidence | Required when evidence exists |
| E-E-A-T | Experience, Expertise, Authoritativeness, Trust | Required |
| Technical hygiene | Technical findings translated into client meaning | Required |
| Headings | Semantic structure explained | Required when assessed |
| Schema/entity trust | Structured-data implications explained | Required when assessed |
| Performance | User/conversion consequence, not metric dumping | Required when assessed |
| Strengths | Clearly identify what is working and should be preserved | Required |
| Limitations | Explain why evidence is unavailable and what not to infer | Required |
| Evidence appendix | Traceable source/status/provenance | Required internally; client presentation may be simplified |

## Mandatory exact-field regressions

The following are initial locked examples. Tests may add fields, but may not replace these with aliases.

| Source | Source-native field | Canonical field | Regression expectation |
|---|---|---|---|
| DataForSEO On-Page | `meta.title` | `site.pages[].title` | exact lineage retained |
| DataForSEO On-Page | `meta.description` | `site.pages[].metaDescription` | exact lineage retained |
| DataForSEO On-Page | `meta.canonical` | `site.pages[].canonicalUrl` | exact lineage retained |
| DataForSEO On-Page | `meta.htags.h1` | `site.pages[].headings.h1` | exact lineage retained |
| DataForSEO On-Page | `meta.content.plain_text_word_count` | `site.pages[].wordCount` | exact lineage retained |
| DataForSEO SERP | `rank_absolute` | `competitors[].evidence.position` | exact lineage retained; `rank_group` adapter fallback only |
| DataForSEO Backlinks | `referring_domains` | `backlinks.authoritySummary.referringDomains` | exact lineage retained |
| DataForSEO Backlinks | `target_spam_score` | `backlinks.authoritySummary.targetSpamScore` | exact lineage retained |
| ScoreSet | n/a | `scores.trustEeatDimension` | value must survive Writer -> Judge -> final model unchanged |
| AuditRequest | n/a | `primaryGoal` | value copied exactly; no reconstruction |
| AuditRequest | n/a | `market` | value copied exactly; no reconstruction |
| AuditRequest | n/a | `language` | value copied exactly; no default overwrite |

## Release failure rule

Narrative v2 fails regression if any of the following is true:

1. a value exists in the governed artifact but is absent from the Writer packet without an explicit exclusion rule;
2. a test passes through an alias rather than the registered canonical path;
3. an unknown value becomes zero/false/empty and changes semantic meaning;
4. an LLM-facing field cannot be traced to its exact source-native or governed canonical name;
5. a Karen-reference report job disappears without an explicit design decision;
6. `trustEeatDimension`, content/funnel, conversion, competitor, or limitation evidence exists but is silently omitted from its intended report section.

This regression audit is additive. It does not authorize production changes or deployment.