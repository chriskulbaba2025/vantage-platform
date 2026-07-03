# Product Requirements Document
## Vantage Authority and Backlink Evidence Adapter

**Document status:** Build-ready bolt-on PRD  
**Version:** 0.1  
**Date:** July 2, 2026  
**Product:** Vantage Conversion Gap Benchmark Audit Platform  
**Component type:** Standalone evidence adapter, later Vantage report module  
**Primary purpose:** Classify backlink evidence into good, bad, and worth pursuing so Vantage can identify credible authority signals, toxic backlink patterns, and realistic outreach opportunities.

---

# 1. Executive Summary

The Authority and Backlink Evidence Adapter is a standalone bolt-on for Vantage. It collects backlink evidence through DataForSEO, classifies backlinks into three useful buckets, and produces a normalized JSON artifact that can later be rendered inside the Vantage report.

The adapter must not start as a score-bearing source.

The first release is a controlled test runner. It accepts a target domain and optional competitor domains, pulls backlink data from DataForSEO, normalizes the data, applies deterministic classification rules, and outputs a reviewable artifact.

The adapter uses three user-facing buckets:

```text
good
bad
worth_pursuing
```

The controlling rule is:

```text
Do not treat backlinks as causal ranking proof.
Use backlink evidence as authority context, risk detection, and outreach direction.
```

---

# 2. Product Decision

## 2.1 Approved Build Path

Build this first as:

```text
Standalone backlink evidence test runner
```

Then integrate it into Vantage as:

```text
Contextual report module
```

Only after validation should it become:

```text
Score-bearing authority signal
```

## 2.2 Root Cause

Backlink data is noisy. If it enters the main Vantage score too early, it can create weak or misleading recommendations.

The adapter must prove that it can separate real editorial authority from irrelevant, spammy, or manipulative link patterns before it affects scoring.

---

# 3. Goals and Non-Goals

## 3.1 Goals

The adapter must:

1. Accept a target domain.
2. Accept up to three competitor domains.
3. Pull backlink summary data for the target.
4. Pull backlink list data for the target.
5. Pull backlink data for competitors.
6. Identify referring domains shared across competitors.
7. Classify backlinks into good, bad, and worth pursuing.
8. Produce a normalized JSON evidence artifact.
9. Produce a human-readable test summary.
10. Store raw and normalized evidence separately.
11. Show confidence for each classification.
12. Avoid causal ranking claims.
13. Support later insertion into Vantage report pages.
14. Track DataForSEO request cost per run.
15. Support manual review before any recommendation is used in a client report.

## 3.2 Non-Goals

The adapter will not:

1. Circumvent robots.txt or access controls.
2. Crawl entire third-party websites.
3. Copy competitor backlink tactics blindly.
4. Recommend buying links.
5. Estimate competitor revenue.
6. Infer competitor traffic from backlink data alone.
7. Automatically disavow links.
8. Modify a client website.
9. Affect the Vantage readiness score during the first test phase.
10. Treat DataForSEO metrics as complete proof of link value.

---

# 4. Evidence Source

## 4.1 Primary Provider

Use DataForSEO Backlinks API.

Required endpoint support:

```text
backlinks summary
backlinks list
page or domain intersection for competitor opportunity discovery
```

The adapter must use a small isolated client wrapper so credentials and provider-specific logic do not leak into the rest of the system.

---

# 5. User Personas

## 5.1 Primary User: Principal Auditor

Needs:

```text
A clean view of whether a client has credible authority signals,
spam risk, or practical link-building opportunities.
```

## 5.2 Secondary User: SEO / Content Strategist

Needs:

```text
A filtered outreach list based on real competitor link patterns,
not a raw backlink dump.
```

## 5.3 Secondary User: Client

Needs:

```text
A clear explanation of authority gaps and link-building opportunities
without technical backlink jargon.
```

---

# 6. Core Workflow

## 6.1 Standalone Test Runner Flow

```text
User enters target domain
→ optional competitor domains are entered
→ adapter validates domains
→ adapter creates backlink test run
→ DataForSEO summary request runs for target
→ DataForSEO backlink list request runs for target
→ DataForSEO competitor or competitor-domain comparison runs
→ evidence is normalized
→ each backlink is scored
→ backlink is classified into one of three buckets
→ JSON artifact is saved
→ test summary is generated
→ auditor reviews output
```

## 6.2 Later Vantage Integration Flow

```text
Vantage audit completes core evidence collection
→ Authority and Backlink Evidence Adapter runs after competitor benchmark
→ backlink artifact is stored under audit evidence
→ report renders authority panel
→ findings remain contextual unless scoring version approves score-bearing use
```

---

# 7. Three-Bucket Classification

## 7.1 Good Backlinks

A backlink is classified as good when it passes the relevance, authority, placement, and spam checks.

Required pattern:

```text
Relevant topic
+ acceptable authority signal
+ low spam score
+ natural anchor text
+ editorial or content-like placement
= good
```

Good backlinks are not automatically recommendations. They are evidence of existing authority.

## 7.2 Bad Backlinks

A backlink is classified as bad when it shows spam, manipulation, irrelevance, or low-trust patterns.

Required pattern:

```text
High spam score
OR irrelevant topic
OR manipulative anchor pattern
OR sitewide/footer/widget pattern
OR excessive external-link pattern
= bad
```

Bad backlinks are not automatically disavow recommendations. They are risk signals requiring review.

## 7.3 Worth Pursuing Backlinks

A backlink opportunity is classified as worth pursuing when a referring domain links to competitors, appears relevant, has low spam risk, and does not currently link to the client.

Required pattern:

```text
Links to competitor
+ does not link to client
+ relevant topic
+ low spam score
+ authority signal is acceptable
+ placement appears editorial/resource-like
= worth_pursuing
```

Worth pursuing means:

```text
This domain or page should be reviewed for outreach.
```

It does not mean:

```text
The client should copy the exact competitor link.
```

---

# 8. Scoring Model

## 8.1 Factor Scores

Each backlink receives four factor scores.

```text
relevance_score: 0–25
authority_score: 0–25
placement_score: 0–25
spam_safety_score: 0–25
```

Total:

```text
backlink_quality_score = relevance_score
                       + authority_score
                       + placement_score
                       + spam_safety_score
```

Maximum score:

```text
100
```

## 8.2 Relevance Score

```text
25 = referring page is clearly about the same or adjacent topic
18 = referring domain is relevant, but page topic is broad
10 = weak topical overlap
0  = irrelevant topic
```

Initial relevance can be inferred from:

```text
referring page title
referring page URL
anchor text
domain category if available
client service/topic keywords
competitor topic cluster if available
```

Manual review may override relevance during PoC.

## 8.3 Authority Score

```text
25 = strong rank/domain signal
18 = acceptable rank/domain signal
10 = weak but real domain signal
0  = no meaningful authority signal
```

Inputs:

```text
domain_from_rank
page_from_rank
target rank
referring domain count
referring page count
```

Authority must not override spam risk. A high-authority spammy or irrelevant page must still be downgraded.

## 8.4 Placement Score

```text
25 = article/main/section placement
18 = resource page or contextual list placement
10 = author bio, generic directory, or weak contextual placement
0  = footer, sidebar, widget, sitewide, or unclear placement
```

Inputs:

```text
semantic_location
link_type
link_attribute
links_count
external_links_count
```

## 8.5 Spam Safety Score

Use DataForSEO Spam Score bands:

```text
25 = spam_score 0–30
10 = spam_score 31–60
0  = spam_score 61–100
```

If spam score is unavailable:

```text
spam_safety_score = 10
classification_confidence is reduced
manual review required
```

---

# 9. Bucket Rules

## 9.1 Good

```text
backlink_quality_score >= 75
AND spam_score <= 30
AND relevance_score >= 18
AND placement_score >= 18
```

Evidence class:

```text
supported
```

If page relevance is manually confirmed:

```text
strongly_supported
```

## 9.2 Bad

```text
spam_score >= 61
OR relevance_score = 0
OR placement_score = 0
OR anchor_text_pattern = spammy
```

Evidence class:

```text
supported
```

If two or more red flags are present:

```text
strongly_supported
```

## 9.3 Worth Pursuing

```text
competitor_overlap_count >= 1
AND client_has_link_from_domain = false
AND spam_score <= 30
AND relevance_score >= 18
AND placement_score >= 18
```

Higher priority:

```text
competitor_overlap_count >= 2
```

Evidence class:

```text
supported
```

If the same domain links to two or more competitors and passes manual review:

```text
strongly_supported
```

---

# 10. Confidence Model

Each classification gets a confidence value from 0.00 to 1.00.

```text
classification_confidence =
  source_completeness × 0.25
+ relevance_confidence × 0.25
+ spam_confidence × 0.20
+ placement_confidence × 0.20
+ competitor_overlap_confidence × 0.10
```

## 10.1 Confidence Bands

```text
0.85–1.00 = high confidence
0.70–0.84 = moderate confidence
0.50–0.69 = limited confidence
0.00–0.49 = directional only
```

## 10.2 Confidence Reduction Rules

Reduce confidence when:

```text
spam score is missing
semantic location is missing
anchor text is missing
referring page is blocked
competitor overlap is inferred from domain only
topic relevance is machine-inferred only
```

---

# 11. Data Model

## 11.1 Backlink Test Run

```json
{
  "runId": "uuid",
  "mode": "standalone_test",
  "targetDomain": "example.com",
  "competitorDomains": [
    "competitor-a.com",
    "competitor-b.com",
    "competitor-c.com"
  ],
  "provider": "dataforseo",
  "status": "completed",
  "createdAt": "2026-07-02T00:00:00Z",
  "completedAt": "2026-07-02T00:00:00Z",
  "requestCount": 0,
  "estimatedCost": 0,
  "rawArtifactKey": "backlinks/runs/run-uuid/raw.json",
  "normalizedArtifactKey": "backlinks/runs/run-uuid/normalized.json",
  "summaryArtifactKey": "backlinks/runs/run-uuid/summary.json"
}
```

## 11.2 Normalized Backlink Record

```json
{
  "source": "dataforseo",
  "targetDomain": "example.com",
  "referringDomain": "publisher.com",
  "referringPageUrl": "https://publisher.com/example-article/",
  "targetUrl": "https://example.com/service/",
  "anchorText": "example service provider",
  "linkType": "anchor",
  "linkAttributes": ["nofollow"],
  "semanticLocation": "article",
  "firstSeen": "2026-01-10",
  "lastSeen": "2026-06-30",
  "isLost": false,
  "linksCount": 1,
  "externalLinksCount": 24,
  "domainRank": 312,
  "pageRank": 88,
  "spamScore": 12,
  "targetSpamScore": 8,
  "competitorOverlapCount": 2,
  "clientHasLinkFromDomain": false,
  "relevanceScore": 22,
  "authorityScore": 18,
  "placementScore": 25,
  "spamSafetyScore": 25,
  "backlinkQualityScore": 90,
  "bucket": "worth_pursuing",
  "classificationConfidence": 0.88,
  "evidenceClass": "strongly_supported",
  "rationale": "Relevant article placement with low spam score and links to two competitors but not the client."
}
```

## 11.3 Output Summary

```json
{
  "targetDomain": "example.com",
  "totalBacklinksReviewed": 500,
  "goodCount": 82,
  "badCount": 41,
  "worthPursuingCount": 27,
  "topGoodLinks": [],
  "topBadPatterns": [],
  "topWorthPursuingDomains": [],
  "authoritySummary": {
    "referringDomains": 0,
    "backlinks": 0,
    "backlinksSpamScore": 0,
    "targetSpamScore": 0
  },
  "limitations": [],
  "recommendedUse": "contextual_report_only"
}
```

---

# 12. Report Output

## 12.1 Standalone Test Summary

The standalone runner must output:

```text
Target domain
Competitor domains
DataForSEO endpoints used
Request count
Estimated cost
Backlinks reviewed
Good backlinks
Bad backlinks
Worth pursuing opportunities
Top referring domains
Top spam-risk patterns
Top outreach targets
Limitations
Manual review required
```

## 12.2 Later Vantage Report Section

Add a future report section named:

```text
Authority and Backlink Evidence
```

It should include:

```text
Authority summary
Good backlink examples
Bad backlink risk patterns
Worth pursuing outreach targets
Competitor overlap summary
Confidence limitations
Recommended next action
```

## 12.3 Client-Facing Language Rules

Use:

```text
This is an authority signal.
This is a backlink risk pattern.
This is a potential outreach target.
This domain is worth manual review.
```

Do not use:

```text
This backlink will improve rankings.
This competitor ranks because of this link.
Copy this backlink.
Disavow this link now.
```

---

# 13. Vantage Integration Rules

## 13.1 Phase 1 — Standalone Only

The adapter runs outside the normal audit pipeline.

```text
No score impact.
No automatic report insertion.
No client-facing use without manual review.
```

## 13.2 Phase 2 — Contextual Report Module

After test validation, the adapter may appear in the report as contextual evidence.

```text
No readiness score impact.
No finding priority score impact.
Evidence Confidence Score may show backlink source availability only if approved.
```

## 13.3 Phase 3 — Score-Bearing Evidence

The adapter may affect scoring only after:

```text
5–10 test sites are reviewed
false-positive rate is measured
manual review confirms usefulness
classification thresholds are tuned
Principal Auditor approves scoring use
scoring version is updated
calibration record is stored
```

---

# 14. Security and Compliance

## 14.1 Credentials

Store DataForSEO credentials server-side only.

Never expose credentials in:

```text
browser code
Netlify public variables
client reports
logs
GitHub
n8n exported workflow files
```

## 14.2 Data Handling

Store only business/domain-level backlink evidence.

Do not store:

```text
personal data
email addresses scraped from third-party pages
private contact details
full copied article content
```

## 14.3 Crawling Constraint

The adapter must rely on DataForSEO data and must not crawl competitor domains beyond approved page checks already allowed by Vantage.

---

# 15. Error Handling

## 15.1 Provider Failure

If DataForSEO fails:

```text
mark source_status = failed
save error category
do not fail the whole Vantage audit
do not generate backlink recommendations
```

## 15.2 Partial Evidence

If only summary data is available:

```text
produce authority summary
do not classify individual backlinks
mark classification unavailable
```

## 15.3 Missing Competitor Domains

If competitor domains are not provided:

```text
run target-domain backlink classification only
skip worth_pursuing bucket
record limitation
```

## 15.4 Missing Spam Score

If spam score is missing:

```text
classification may proceed
spam_safety_score = 10
confidence is reduced
manual review required
```

---

# 16. Cost Controls

## 16.1 Default Test Limits

```text
Target backlinks limit: 500
Competitor backlinks limit: 250 per competitor
Competitor domains: max 3
Request timeout: 60 seconds
Retry attempts: 1
```

## 16.2 Hard Limits

```text
Maximum backlinks per standalone run: 2,000
Maximum competitors per run: 3
Maximum DataForSEO retries per endpoint: 1
Maximum concurrent backlink test runs: 1
```

## 16.3 Cost Logging

Every run must store:

```text
endpoint used
request count
result count
estimated cost
run duration
failure count
```

---

# 17. Acceptance Criteria

## 17.1 Standalone Runner

```text
[ ] User can run adapter against one target domain
[ ] User can include up to three competitor domains
[ ] DataForSEO credentials are read server-side only
[ ] Backlinks Summary request runs
[ ] Backlinks request runs
[ ] Competitor overlap is calculated where competitors exist
[ ] Raw JSON is stored
[ ] Normalized JSON is stored
[ ] Output summary is generated
[ ] Each backlink receives factor scores
[ ] Each backlink is assigned to good, bad, or worth_pursuing
[ ] Each classification includes confidence
[ ] Each classification includes rationale
[ ] Request count and estimated cost are logged
[ ] Provider failure does not crash the worker
```

## 17.2 Classification

```text
[ ] Spam score 61–100 forces bad classification unless manually overridden
[ ] Spam score 0–30 can qualify for good or worth_pursuing
[ ] Relevance score below threshold prevents good classification
[ ] Footer/sidebar/widget placement prevents good classification
[ ] Competitor overlap can create worth_pursuing only when spam and relevance pass
[ ] Missing evidence reduces confidence instead of inventing certainty
```

## 17.3 Vantage Integration Readiness

```text
[ ] Adapter output is valid JSON
[ ] Artifact path follows Vantage storage conventions
[ ] Report renderer can consume artifact without API calls at page load
[ ] Source limitation is visible
[ ] No readiness score changes occur in Phase 1
[ ] No priority score changes occur in Phase 1
[ ] Manual review gate exists before client-facing use
```

---

# 18. Test Plan

## 18.1 Test Sample

Run the adapter against 5–10 domains:

```text
1 local service business
1 professional service business
1 multi-service business
1 site with weak backlink profile
1 site with obvious spam backlinks
2–5 competitor-rich sites
```

## 18.2 Manual Review Questions

For each run, auditor answers:

```text
Were good backlinks actually useful examples?
Were bad backlinks actually risky or low quality?
Were worth_pursuing domains realistic outreach targets?
Were there false positives?
Were there false negatives?
Did the adapter surface anything a client would value?
Did the adapter reduce manual backlink review time?
Was DataForSEO cost acceptable?
Should this remain contextual or become score-bearing later?
```

## 18.3 Pass Criteria

The adapter passes PoC when:

```text
[ ] At least 5 domains tested
[ ] Classification output is understandable
[ ] Worth pursuing bucket produces usable outreach targets
[ ] Bad bucket avoids overclaiming toxicity
[ ] Good bucket reflects real authority examples
[ ] False-positive rate is acceptable after review
[ ] Cost per run is recorded
[ ] Manual review confirms report value
[ ] Principal Auditor approves Phase 2 report integration
```

---

# 19. Implementation Phases

## Phase 1 — Standalone Backlink Runner

Deliver:

```text
DataForSEO client
domain validator
summary fetcher
backlink list fetcher
normalizer
bucket classifier
JSON artifact writer
console or HTML summary output
cost logger
```

## Phase 2 — Competitor Opportunity Layer

Deliver:

```text
competitor domain input
competitor backlink fetch
shared referring domain detection
client missing-domain detection
worth_pursuing classifier
outreach target summary
```

## Phase 3 — Vantage Artifact Integration

Deliver:

```text
audit-linked artifact storage
source status integration
authority report panel
limitations display
manual review status
```

## Phase 4 — Calibration and Scoring Review

Deliver:

```text
5–10 site validation
false-positive log
threshold tuning
Principal Auditor review
scoring-governance decision
```

---

# 20. Execution Contract

## Repository

```text
C:\Users\cpkul\Desktop\vantage-platform
```

## Initial Implementation Location

```text
services\worker\src\adapters\dataforseo-backlinks\
```

## Local Runner Location

```text
services\worker\src\runners\run-backlink-test.js
```

## Required Files

```text
services\worker\src\adapters\dataforseo-backlinks\dataforseo-backlinks-client.js
services\worker\src\adapters\dataforseo-backlinks\backlink-normalizer.js
services\worker\src\adapters\dataforseo-backlinks\backlink-classifier.js
services\worker\src\adapters\dataforseo-backlinks\backlink-artifact-writer.js
services\worker\src\adapters\dataforseo-backlinks\backlink-test-fixtures.json
services\worker\src\adapters\dataforseo-backlinks\backlink-adapter.test.js
services\worker\src\runners\run-backlink-test.js
```

## Required Package Script

Add one package script in the correct worker package file:

```text
npm run test:backlinks
```

The script must run the backlink adapter test suite.

## Required Standalone Runner

The standalone runner must support this command shape:

```text
node services\worker\src\runners\run-backlink-test.js --target example.com --competitors competitor-a.com,competitor-b.com,competitor-c.com
```

It must also support fixture mode:

```text
node services\worker\src\runners\run-backlink-test.js --target example.com --competitors competitor-a.com,competitor-b.com,competitor-c.com --fixture
```

## Required Outputs

The runner must produce:

```text
raw DataForSEO response artifact
normalized backlink artifact
summary artifact
console summary showing good, bad, and worth_pursuing counts
```

Default local output path:

```text
artifacts\local\backlink-tests\
```

Expected local artifacts:

```text
artifacts\local\backlink-tests\raw-backlinks.json
artifacts\local\backlink-tests\normalized-backlinks.json
artifacts\local\backlink-tests\backlink-summary.json
```

## Required Environment Variables

Use server-side environment variables only:

```text
DATAFORSEO_LOGIN
DATAFORSEO_PASSWORD
```

Do not expose credentials in browser code, frontend code, logs, fixtures, committed files, or report artifacts.

## Required Buckets

Every normalized backlink record must classify into one of:

```text
good
bad
worth_pursuing
ignore
```

The client-facing buckets are:

```text
good
bad
worth_pursuing
```

The internal `ignore` bucket is allowed for records that are too incomplete, irrelevant, or duplicated to use.

## Required Scoring Fields

Each normalized record must include:

```text
referringDomain
referringPageUrl
targetUrl
anchorText
linkType
linkAttributes
semanticLocation
firstSeen
lastSeen
isLost
linksCount
externalLinksCount
domainRank
pageRank
spamScore
targetSpamScore
competitorOverlapCount
clientHasLinkFromDomain
relevanceScore
authorityScore
placementScore
spamSafetyScore
backlinkQualityScore
bucket
classificationConfidence
evidenceClass
rationale
```

## Required Classification Rules

Good:

```text
backlinkQualityScore >= 75
AND spamScore <= 30
AND relevanceScore >= 18
AND placementScore >= 18
```

Bad:

```text
spamScore >= 61
OR relevanceScore = 0
OR placementScore = 0
OR anchorTextPattern = spammy
```

Worth pursuing:

```text
competitorOverlapCount >= 1
AND clientHasLinkFromDomain = false
AND spamScore <= 30
AND relevanceScore >= 18
AND placementScore >= 18
```

Missing spam score:

```text
spamSafetyScore = 10
classificationConfidence reduced
manual review required
```

## Required Summary Fields

The summary artifact must include:

```text
targetDomain
competitorDomains
totalBacklinksReviewed
goodCount
badCount
worthPursuingCount
ignoredCount
topGoodLinks
topBadPatterns
topWorthPursuingDomains
authoritySummary
limitations
requestCount
estimatedCost
recommendedUse
```

For Phase 1:

```text
recommendedUse = contextual_report_only
```

## Required Safety Constraints

The implementation must not:

```text
change Vantage readiness scoring
change Vantage priority scoring
modify production audit orchestration
modify n8n workflow assumptions
add frontend report rendering yet
add database migrations yet
require live DataForSEO credentials to run tests
expose credentials
make causal backlink or ranking claims
recommend disavow actions automatically
```

## Acceptance Proof

The task is accepted only when:

```text
npm run test:backlinks passes
fixture-mode standalone runner works
raw artifact is written
normalized artifact is written
summary artifact is written
console output shows good, bad, worth_pursuing, and ignored counts
no production Vantage score path is changed
no production audit pipeline is changed
credentials are not exposed
output JSON matches the PRD data model
```

---

# 21. Definition of Done

The bolt-on is complete when:

```text
[ ] A standalone run can classify backlink evidence for one domain
[ ] Optional competitor domains can be included
[ ] Backlinks are bucketed into good, bad, and worth_pursuing
[ ] Every bucket item includes evidence and rationale
[ ] Every bucket item includes confidence
[ ] Raw and normalized artifacts are saved
[ ] Cost is logged
[ ] The adapter fails safely
[ ] No credentials are exposed
[ ] No Vantage score is changed in Phase 1
[ ] A human-readable summary is generated
[ ] Five or more test domains are reviewed
[ ] Principal Auditor decides whether to integrate as contextual report evidence
```

---

# 22. Final Product Rule

The backlink adapter should not answer:

```text
Why does this competitor rank?
```

It should answer:

```text
Which authority signals look credible,
which backlink patterns look risky,
and which referring domains are worth manual outreach review?
```

That is the correct fit for Vantage.
