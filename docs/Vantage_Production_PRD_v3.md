# Vantage Website Decision System
## Production Product Requirements Document — Version 3.0

**Status:** Build and audit specification  
**Date:** July 26, 2026  
**Owner:** Omnipressence  
**Primary product:** Vantage Phase 1 Conversion Readiness Audit  
**Expansion layer:** Vantage Continuous Evidence  
**Deployment baseline:** Railway worker, self-hosted n8n, static HTML reporting, Puppeteer PDF rendering  
**Primary crawl provider:** DataForSEO On-Page API  
**Performance provider:** Google PageSpeed Insights API  
**Performance fallback:** Lighthouse CLI  
**Optional owned-data providers:** Google Analytics 4 and Google Search Console  

---

# 1. Product Definition

Vantage is an evidence-grounded website decision system.

It determines:

1. what prevents a website from earning trust and converting qualified visitors;
2. what evidence supports each finding;
3. which corrections should be made first;
4. which evidence could not be collected;
5. whether completed corrections improve the website over time.

Vantage is not a generic SEO crawler, keyword report, or automated promise of revenue growth.

The product must never convert missing, failed, partial, or unauthorized evidence into a positive or negative finding.

---

# 2. Product Scope

## 2.1 Phase 1 — Conversion Readiness Audit

Phase 1 is a point-in-time assessment of:

- conversion pathways;
- offer and service clarity;
- trust and E-E-A-T evidence;
- technical SEO hygiene;
- page structure and semantic clarity;
- content depth and funnel coverage;
- schema and entity clarity;
- mobile and desktop performance;
- competitor conversion positioning;
- implementation constraints;
- AI-search readiness;
- internal-link opportunities.

## 2.2 Continuous Evidence Layer

The Continuous Evidence Layer begins only after a Phase 1 baseline exists.

It monitors:

- conversion-weighted content decay;
- material technical changes;
- qualified competitor content gaps;
- page-level search conflict and cannibalization;
- changes against completed recommendations;
- source availability and integration health.

It does not claim business outcomes unless GA4, GSC, CRM, booking, or revenue evidence supports the claim.

## 2.3 Deferred Outcomes Layer

Qualified leads, bookings, sales, lead quality, and revenue attribution are deferred until the required measurement systems are connected and sufficient post-change data exists.

The absence of outcome data must not block Phase 1.

---

# 3. Product Principles

## 3.1 Readiness and Confidence Are Separate

Vantage must always display:

- **Conversion Readiness Score:** condition of the website based on completed score-bearing modules.
- **Evidence Confidence Score:** strength and completeness of the evidence supporting the report.

A site may have low readiness with high confidence or high readiness with limited confidence.

## 3.2 Missing Evidence Is Not a Finding

A source failure or missing authorization must produce:

- `UNAVAILABLE`
- `FAILED`
- `PARTIAL`
- `NOT_CONNECTED`
- `BLOCKED`

It must never produce a score of zero for the business.

## 3.3 Findings Require Traceable Evidence

Every finding must contain:

- evidence source;
- source status;
- observed value;
- rule identifier;
- affected URL or entity;
- finding confidence;
- business impact;
- recommended correction;
- implementation effort;
- verification method.

## 3.4 One Canonical Evidence Model

All providers must normalize into one provider-independent evidence schema.

Report logic must never depend directly on a provider-specific response format.

## 3.5 Provider Failure Must Degrade Gracefully

A provider failure may reduce confidence or suppress an affected module. It must not invalidate unrelated modules or generate fabricated replacement data.

## 3.6 Recommendations Must Be Conversion-Relevant

Search demand, competitor coverage, rankings, impressions, or crawl findings are insufficient by themselves.

A recommendation must connect to at least one of:

- offer clarity;
- buyer question;
- trust requirement;
- conversion path;
- service discovery;
- commercial page;
- implementation risk;
- measurable site objective.

---

# 4. Target Users

## 4.1 Principal Auditor

Reviews source health, findings, scoring, competitor selections, limitations, and report language before delivery.

## 4.2 Auditor

Creates audits, configures client inputs, reviews evidence, and prepares reports.

## 4.3 Client Viewer

Receives read-only access to the approved report. The client cannot access raw credentials, source tokens, internal notes, or other clients.

---

# 5. Required Inputs

## 5.1 Mandatory

- target URL;
- business name;
- geographic market;
- language/locale;
- primary conversion goal;
- primary services or offers.

## 5.2 Recommended

- up to three supplied market competitors;
- business category;
- target audiences;
- known buyer objections;
- primary conversion URLs;
- CMS or platform access notes.

## 5.3 Optional Authorizations

- GA4 property;
- GSC property;
- DataForSEO credentials at workspace level;
- PageSpeed API key at workspace level.

An audit must run without GA4 or GSC.

---

# 6. System Architecture

## 6.1 Components

| Component | Requirement |
|---|---|
| Audit intake | Web application or n8n webhook |
| Orchestration | Existing self-hosted n8n |
| Audit worker | Dockerized Node.js service on Railway |
| Primary crawl | DataForSEO On-Page API |
| Performance | PageSpeed Insights API |
| Performance fallback | Lighthouse CLI in Railway worker |
| Analytics | GA4 Data API, optional |
| Search performance | GSC API, optional |
| SERP and backlink enrichment | DataForSEO APIs, gated by audit configuration |
| Storage | PostgreSQL-compatible database plus object storage |
| HTML report | Static generated report |
| PDF report | Puppeteer rendering of approved HTML |
| Monitoring | Provider success rate, latency, quota, and error logging |

## 6.2 Audit Flow

```
Create audit
→ validate inputs
→ create source collection plan
→ collect each source independently
→ assign source statuses
→ normalize completed evidence
→ run module gates
→ generate findings
→ calculate readiness and confidence
→ render draft HTML
→ principal auditor review
→ approve report
→ render final HTML and PDF
→ preserve baseline for future comparison
```

## 6.3 Independence Requirement

Each adapter must run independently.

A failure in PageSpeed must not stop crawling.  
A failure in GA4 must not stop conversion-path analysis.  
A blocked competitor must not stop the client-site audit.

---

# 7. Evidence Source Architecture

## 7.1 Universal Source Status

Every source and subtask must use one status:

| Status | Definition |
|---|---|
| `AVAILABLE` | Required evidence returned and validated |
| `PARTIAL` | Some required evidence returned |
| `FAILED` | Provider or internal execution failed |
| `NOT_CONNECTED` | Authorization or credentials were not supplied |
| `UNAVAILABLE` | Provider returned no usable data |
| `BLOCKED` | robots.txt, authentication, consent, or access restrictions prevented collection |
| `NOT_APPLICABLE` | Evidence is not relevant to this audit |

Each status record must include:

- provider;
- adapter version;
- start and completion time;
- request or task identifier;
- retry count;
- returned record count;
- expected record count where known;
- error category;
- human-readable limitation;
- raw artifact reference.

---

# 8. Primary Crawl: DataForSEO On-Page API

## 8.1 Decision

DataForSEO On-Page API replaces Screaming Frog as the production crawl provider.

Screaming Frog is removed from the production dependency chain.

## 8.2 Required Flow

```
POST on_page/task_post
→ store task ID
→ poll task status
→ retrieve summary
→ retrieve pages
→ retrieve links
→ retrieve duplicate tags
→ retrieve duplicate content
→ retrieve microdata or structured-data evidence
→ normalize results
```

## 8.3 Required Crawl Evidence

At minimum:

- crawled URL;
- final URL;
- status code;
- redirect destination;
- indexability;
- robots directives;
- canonical URL;
- page title;
- meta description;
- H1–H6 structure;
- word count;
- internal inlinks;
- internal outlinks;
- broken internal links;
- broken external resources when available;
- image alt coverage;
- image size evidence when available;
- schema or microdata evidence;
- content duplication signals;
- sitemap membership when available;
- crawl depth;
- response time;
- page size;
- detected technologies when available.

## 8.4 Crawl Limits

Audit configuration must set:

- maximum pages;
- maximum crawl depth;
- include/exclude patterns;
- JavaScript rendering requirement;
- sitemap preference;
- external resource limits.

Default launch limit: **500 HTML pages per audit**.

The worker must stop predictably at the configured limit and report partial coverage. It must not imply a complete-site audit when the limit is reached.

## 8.5 Crawl Failure Rules

| Condition | Required behaviour |
|---|---|
| Task submission fails | Retry twice with exponential backoff |
| Task remains incomplete beyond timeout | Mark `FAILED`; preserve task ID |
| robots.txt blocks site | Mark `BLOCKED`; do not bypass |
| Login wall blocks site | Mark `BLOCKED`; request authorized access outside the report |
| Page ceiling reached | Mark `PARTIAL`; report captured and estimated coverage |
| JavaScript content missing | Mark affected pages `PARTIAL`; do not infer absent content |
| Provider quota exhausted | Mark `FAILED`; stop score-bearing crawl modules |

## 8.6 Crawl Gate

The following modules require a valid crawl:

- technical hygiene;
- headings and semantics;
- content depth;
- internal links;
- schema and entity evidence;
- on-site trust evidence;
- conversion-path discovery;
- topical coverage.

If no crawl evidence is available, these modules must show **Not Assessed** and must not contribute to the readiness score.

---

# 9. Performance: PageSpeed and Lighthouse

## 9.1 Primary Provider

Google PageSpeed Insights API is the primary performance source.

## 9.2 Fallback Provider

Lighthouse CLI is the automatic fallback when PageSpeed returns:

- quota or rate-limit errors;
- provider timeout;
- repeated 5xx errors;
- invalid response;
- no usable Lighthouse result.

## 9.3 Required Collection

At minimum:

- homepage mobile;
- homepage desktop;
- primary conversion page mobile;
- primary conversion page desktop.

Additional page sampling may include service, location, article, and contact templates.

Maximum launch sample: **10 URLs × 2 device profiles**.

## 9.4 Performance Provenance

Every metric must identify:

- provider;
- device;
- run time;
- URL;
- lab versus field status;
- PageSpeed strategy or Lighthouse configuration;
- raw result reference.

PageSpeed lab scores and Lighthouse CLI results must never be described as field performance.

CrUX data may be reported only when explicitly returned and sufficiently populated.

## 9.5 Fallback Rules

```
PageSpeed first attempt
→ retry once for transient errors
→ if still unavailable, run Lighthouse CLI
→ if Lighthouse succeeds: source status PARTIAL or AVAILABLE with fallback noted
→ if Lighthouse fails: performance module NOT ASSESSED
```

A missing performance result must not become a score of zero.

## 9.6 Performance Acceptance

The same test site must complete:

- 10 consecutive PageSpeed-or-fallback runs;
- at least 9 successful performance modules;
- no false score when both providers fail;
- consistent provider provenance in the report.

---

# 10. Google Search Console

## 10.1 Status

GSC is optional for Phase 1 and required for score-bearing search-performance monitoring.

## 10.2 Required Evidence

When connected:

- clicks;
- impressions;
- CTR;
- average position;
- query;
- landing page;
- device;
- country;
- date range.

Default comparison windows:

- most recent complete 28 days;
- preceding 28 days;
- optional year-over-year comparison when sufficient history exists.

## 10.3 Phase 1 Uses

GSC may strengthen:

- topic demand;
- buyer-question coverage;
- title and snippet alignment;
- page-query mismatch;
- search opportunity;
- content-gap prioritization.

GSC absence must not lower the Conversion Readiness Score.

## 10.4 Continuous Evidence Uses

GSC is required for:

- conversion-weighted content decay;
- cannibalization detection;
- query segmentation;
- CTR diagnostics;
- search visibility change reporting.

## 10.5 Data Sufficiency Gate

A GSC-derived finding must not be score-bearing unless minimum thresholds are met.

Launch defaults:

- page or query has at least 100 impressions in the selected period; or
- the finding is labelled directional and receives limited confidence.

Thresholds must be configurable and versioned.

---

# 11. Google Analytics 4

## 11.1 Status

GA4 is optional for Phase 1.

## 11.2 Required Evidence

When connected, collect aggregated data only:

- sessions;
- engaged sessions;
- engagement rate;
- landing pages;
- traffic source/medium;
- key events;
- event counts;
- conversion rate where configured;
- device category.

No user-level records may be stored.

## 11.3 Measurement Readiness

Vantage must assess whether GA4 can answer the client’s primary conversion question.

It must identify:

- missing key events;
- ambiguous events;
- duplicate events;
- absent source attribution;
- broken or incomplete funnels;
- conversion actions occurring on third-party platforms.

## 11.4 Outcome Claims

Vantage may claim an outcome only when:

- the event definition is documented;
- the baseline window is preserved;
- the post-change window is sufficient;
- material confounders are disclosed;
- the change is described as association unless causation is independently established.

---

# 12. Competitor Opportunity Layer

## 12.1 Purpose

Competitor analysis identifies market patterns and missing conversion-relevant coverage. It does not prove causal ranking factors.

## 12.2 Competitor Sources

At launch:

1. user-supplied competitors;
2. DataForSEO localized organic SERP results;
3. auditor approval.

## 12.3 Per-Topic Model

Competitors are selected per priority topic or service cluster, not once per audit.

A candidate competitor must pass:

- geographic relevance;
- service relevance;
- audience relevance;
- commercial intent relevance;
- page-type comparability.

Directories, marketplaces, social profiles, generic news, and irrelevant aggregators must be excluded unless the audit explicitly assesses them.

## 12.4 Qualified Gap Rule

A competitor content gap becomes a recommendation only when it passes:

1. offer alignment;
2. audience alignment;
3. buyer-journey alignment;
4. expertise credibility;
5. conversion-path viability;
6. realistic competitive feasibility.

## 12.5 Competitor Evidence Output

For each retained gap:

- client topic;
- competitor page;
- observed competitor coverage;
- client coverage;
- conversion relevance;
- recommendation;
- confidence;
- limitation statement.

---

# 13. Internal-Link Opportunity Module

## 13.1 Purpose

Generate implementation-ready internal-link recommendations that improve:

- topic hierarchy;
- service discovery;
- conversion progression;
- orphan-page recovery;
- contextual clarity.

## 13.2 Required Output

- source URL;
- target URL;
- proposed anchor;
- relevant surrounding text;
- reason for link;
- funnel stage;
- confidence;
- duplicate-anchor warning.

A topic mention alone is not sufficient justification.

---

# 14. Continuous Evidence Layer

## 14.1 Baseline Requirement

Continuous monitoring cannot begin until an approved Phase 1 evidence artifact exists.

## 14.2 Conversion-Weighted Content Decay

Priority must consider:

- search decline;
- page business relevance;
- conversion importance;
- topic importance;
- recoverability;
- evidence sufficiency.

Traffic decline alone must not determine priority.

## 14.3 Cannibalization

Run only when:

- multiple indexable URLs receive impressions for materially similar queries;
- sufficient GSC data exists;
- overlap persists across the configured period;
- one URL should reasonably own the intent.

## 14.4 Change Report

A recurring report must answer:

- what changed;
- which baseline finding it relates to;
- whether the change matters;
- what evidence supports it;
- whether action is required.

It must not be a generic weekly metrics email.

---

# 15. Scoring Model

## 15.1 Readiness Dimensions

| Dimension | Weight |
|---|---:|
| Conversion Pathways and Offer Clarity | 25% |
| Trust, E-E-A-T, and Risk Reduction | 25% |
| Content and Funnel Coverage | 20% |
| Technical and Performance Readiness | 20% |
| Entity, Schema, and AI-Search Readiness | 10% |

Weights are launch defaults and must be versioned.

## 15.2 Module Eligibility

A dimension score uses only eligible, completed modules.

A module is eligible only when:

- required source gate passes;
- evidence is recent enough;
- evidence is sufficiently complete;
- rules can execute without inference beyond the documented confidence level.

## 15.3 No Silent Reweighting

When a module is unavailable:

- the system may calculate a **provisional readiness score from eligible modules**;
- the report must show the percentage of total intended weight assessed;
- the report must not silently redistribute missing weight;
- the score label must state `Provisional` when assessed weight is below 80%.

If assessed weight is below 60%, no overall numeric readiness score may be shown. Display **Insufficient Evidence for Overall Score**.

## 15.4 Finding Priority

```
Raw Priority
= Conversion Impact × 0.30
+ Gap Severity × 0.25
+ Business Relevance × 0.20
+ Competitive Signal × 0.15
+ Implementation Practicality × 0.10

Final Priority
= Raw Priority × Finding Confidence Modifier
```

Confidence modifiers:

| Confidence | Modifier |
|---|---:|
| Deterministic | 1.00 |
| Strongly supported | 0.90 |
| Supported | 0.75 |
| Directional | 0.55 |
| Insufficient | not score-bearing |

## 15.5 Evidence Confidence

Evidence Confidence must be calculated separately using:

- source availability;
- data completeness;
- source validity;
- data freshness;
- URL matching;
- cross-source agreement;
- competitor relevance;
- rule certainty.

Confidence must roll up:

```
Finding confidence
→ module confidence
→ dimension confidence
→ report confidence
```

A failed optional source must affect only dependent findings.

---

# 16. Finding Contract

Every finding must conform to:

```json
{
  "findingId": "uuid",
  "ruleId": "VAN-TECH-001",
  "ruleVersion": "3.0.0",
  "dimension": "technical_performance",
  "module": "meta_information",
  "title": "Missing meta description",
  "affectedUrls": ["https://example.com/service"],
  "evidence": [
    {
      "provider": "dataforseo_onpage",
      "sourceStatus": "AVAILABLE",
      "field": "meta_description",
      "observedValue": null,
      "artifactRef": "artifact-uri"
    }
  ],
  "confidence": "deterministic",
  "businessImpact": "Search-result messaging is uncontrolled for this page.",
  "recommendation": "Add a page-specific description aligned with the service and buyer intent.",
  "implementationEffort": "low",
  "verificationMethod": "Re-crawl the URL and confirm the description is present.",
  "scoreBearing": true
}
```

No client-facing finding may exist without at least one evidence record.

---

# 17. Report Requirements

## 17.1 Executive Scorecard

Must display:

- Conversion Readiness Score or evidence insufficiency message;
- assessed weight percentage;
- Evidence Confidence Score;
- top root cause;
- top priority findings;
- source-status strip;
- report and scoring versions.

## 17.2 Required Sections

1. Executive scorecard  
2. Priority fixes  
3. Conversion path architecture  
4. Conversion readiness map  
5. Topical map and qualified content opportunities  
6. Competitor benchmark  
7. Trust and E-E-A-T readiness  
8. CMS and platform constraints  
9. Technical SEO hygiene  
10. Heading and semantic structure  
11. Schema and entity clarity  
12. Performance  
13. Internal-link opportunities  
14. Evidence appendix  
15. Deferred and unavailable analysis  

## 17.3 Source Transparency

The Evidence Appendix must list:

- every intended source;
- actual source status;
- provider used;
- fallback used;
- collection time;
- coverage;
- limitation;
- affected report modules.

## 17.4 Language Rules

Reports must not say:

- “the site has no traffic” when GA4/GSC is unavailable;
- “performance is poor” when both performance providers failed;
- “no schema exists” unless valid crawl or rendered-page evidence supports it;
- “competitors outperform” without defined comparative evidence;
- “this will increase revenue” without outcome evidence.

---

# 18. Human Review Gate

Before approval, the Principal Auditor must review:

- source failures and partial coverage;
- top ten findings;
- all high-severity findings;
- competitor selections;
- root-cause statement;
- score eligibility;
- limitations;
- unsupported causal language;
- implementation feasibility.

The report cannot be delivered while status is `draft`.

---

# 19. Provider Monitoring

The system must record daily:

- successful requests;
- failed requests;
- rate-limit errors;
- median latency;
- quota exhaustion;
- fallback frequency;
- adapter version.

Alert conditions:

- provider success below 90% over 24 hours;
- fallback used in more than 25% of audits;
- repeated authentication failures;
- quota exhaustion;
- schema validation failures.

---

# 20. Security and Data Governance

- Store API credentials and OAuth tokens encrypted server-side.
- Use read-only GA4 and GSC scopes.
- Never expose provider credentials in reports or client links.
- Store only aggregated GA4 evidence.
- Respect robots.txt and access restrictions.
- Do not bypass competitor blocking.
- Version scoring rules and adapters.
- Preserve immutable evidence artifacts for approved reports.
- Record human overrides with user, timestamp, reason, previous value, and replacement value.

---

# 21. Launch Acceptance Tests

## 21.1 DataForSEO Crawl

- [ ] Ten test domains complete without manual export.
- [ ] Small, medium, and JavaScript-heavy sites are included.
- [ ] Crawl limits produce `PARTIAL`, not false completeness.
- [ ] Blocked sites produce `BLOCKED`, not a zero score.
- [ ] Required page fields normalize successfully.
- [ ] Raw task IDs and artifacts are preserved.

## 21.2 PageSpeed and Lighthouse

- [ ] PageSpeed runs first.
- [ ] Rate-limit simulation triggers Lighthouse.
- [ ] Lighthouse provenance appears in the report.
- [ ] Failure of both suppresses the performance score.
- [ ] Ten consecutive audits achieve at least 90% performance-module completion.

## 21.3 GA4 and GSC

- [ ] OAuth connection works with read-only scopes.
- [ ] An audit runs when neither is connected.
- [ ] `NOT_CONNECTED` is visible.
- [ ] Optional-source absence does not reduce readiness.
- [ ] GSC thresholds prevent low-volume overinterpretation.
- [ ] GA4 stores no user-level data.

## 21.4 Scoring

- [ ] Missing required crawl evidence suppresses dependent modules.
- [ ] Assessed weight is visible.
- [ ] Below 80% assessed weight labels score provisional.
- [ ] Below 60% assessed weight suppresses the overall score.
- [ ] Findings have rule IDs and evidence.
- [ ] Identical evidence produces identical scores.

## 21.5 Report Quality

- [ ] No placeholder sections.
- [ ] No unavailable source is presented as a business failure.
- [ ] Root cause is supported by top findings.
- [ ] Every recommendation contains a verification method.
- [ ] HTML and PDF match the canonical JSON evidence artifact.
- [ ] Principal Auditor approval is required.

---

# 22. Launch Definition of Done

Vantage is launch-ready only when:

- DataForSEO fully replaces Screaming Frog in the production path;
- PageSpeed-to-Lighthouse fallback passes acceptance testing;
- GA4 and GSC OAuth connections work, while remaining optional;
- provider states and module gates are implemented;
- false scoring from missing evidence is impossible under automated tests;
- the canonical evidence artifact drives HTML and PDF;
- the human review gate is functional;
- five to ten controlled pilot audits pass review;
- each pilot records false positives, false negatives, source failures, audit cost, and completion time;
- scoring and report versions are frozen for launch.

---

# 23. Explicit Non-Goals for Launch

Launch does not require:

- proven revenue lift;
- automated CRM attribution;
- enterprise crawl-budget analysis;
- daily reporting;
- generic low-CTR title rewriting;
- bulk meta-description generation as a standalone feature;
- unrestricted crawler fallbacks;
- autonomous client delivery;
- white-label multi-tenant operation.

---

# 24. Post-Launch Calibration

After the first ten approved audits:

- review every high-severity finding;
- calculate false-positive and false-negative rates;
- review source completion rates;
- measure cost per audit;
- measure auditor review time;
- identify recurring unavailable modules;
- revise thresholds only through a new scoring version.

After outcome data becomes available, add outcome attribution as a separate versioned layer. Do not rewrite historical readiness scores to incorporate later outcomes.

---

# 25. Final Product Position

Vantage launches as:

> **An evidence-grounded conversion-readiness and website decision system that shows what is wrong, why it matters, what to fix first, and exactly which evidence was or was not available.**

It must not launch as a guaranteed growth or revenue platform.
