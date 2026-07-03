# Claude Code Build Prompt
## Build Vantage Backlink Adapter Phase 1

You are working in this repo:

```text
C:\Users\cpkul\Desktop\vantage-platform
```

Task:

Build the Phase 1 standalone **Vantage Authority and Backlink Evidence Adapter**.

This is a bounded standalone adapter. It must not change the live Vantage audit pipeline, readiness scoring, priority scoring, report renderer, n8n flow, Supabase schema, AWS infrastructure, Railway deployment, or frontend.

---

# Root requirement

Create a standalone backlink test runner that can classify backlink evidence into:

```text
good
bad
worth_pursuing
ignore
```

The adapter must work in fixture mode without live DataForSEO credentials.

---

# Product rule

The adapter must answer:

```text
Which authority signals look credible,
which backlink patterns look risky,
and which referring domains are worth manual outreach review?
```

It must not answer:

```text
Why does this competitor rank?
```

It must not make causal ranking claims.

It must not recommend automatic disavow actions.

---

# Required implementation location

Create this folder if missing:

```text
services\worker\src\adapters\dataforseo-backlinks\
```

Create these files:

```text
services\worker\src\adapters\dataforseo-backlinks\dataforseo-backlinks-client.js
services\worker\src\adapters\dataforseo-backlinks\backlink-normalizer.js
services\worker\src\adapters\dataforseo-backlinks\backlink-classifier.js
services\worker\src\adapters\dataforseo-backlinks\backlink-artifact-writer.js
services\worker\src\adapters\dataforseo-backlinks\backlink-test-fixtures.json
services\worker\src\adapters\dataforseo-backlinks\backlink-adapter.test.js
services\worker\src\runners\run-backlink-test.js
```

Add the correct package script in the worker package file:

```text
npm run test:backlinks
```

The script must run the backlink adapter tests.

If no worker package file exists yet, create the smallest safe Node package setup needed to run this local-only adapter and tests.

---

# DataForSEO client requirements

Implement all DataForSEO API access only in:

```text
services\worker\src\adapters\dataforseo-backlinks\dataforseo-backlinks-client.js
```

Use server-side env vars only:

```text
DATAFORSEO_LOGIN
DATAFORSEO_PASSWORD
```

Do not expose credentials in logs, output artifacts, fixture files, frontend code, committed files, report data, or test output.

The client must support these logical operations:

```text
fetchBacklinkSummary(target)
fetchBacklinks(target, options)
fetchCompetitorIntersection(target, competitorDomains, options)
```

The live client may be minimal for Phase 1, but the module boundaries must be correct.

If credentials are missing and fixture mode is not enabled, fail with a clear error.

Do not let missing credentials break fixture-mode tests.

---

# Fixture mode

The runner must support:

```text
node services\worker\src\runners\run-backlink-test.js --target example.com --competitors competitor-a.com,competitor-b.com,competitor-c.com --fixture
```

Fixture mode must read from:

```text
services\worker\src\adapters\dataforseo-backlinks\backlink-test-fixtures.json
```

The fixture must include enough records to prove all four classifications:

```text
good
bad
worth_pursuing
ignore
```

---

# Normalizer requirements

Implement normalizing in:

```text
services\worker\src\adapters\dataforseo-backlinks\backlink-normalizer.js
```

Every normalized backlink record must include:

```text
source
targetDomain
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

The normalizer must tolerate missing fields. Missing fields must reduce confidence where relevant instead of crashing.

---

# Classifier requirements

Implement classification in:

```text
services\worker\src\adapters\dataforseo-backlinks\backlink-classifier.js
```

Use this scoring model:

```text
relevanceScore: 0–25
authorityScore: 0–25
placementScore: 0–25
spamSafetyScore: 0–25
backlinkQualityScore = relevanceScore + authorityScore + placementScore + spamSafetyScore
```

Use these rules.

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

Ignore:

```text
record is duplicated
OR record is too incomplete for safe use
OR record does not meet good, bad, or worth_pursuing rules
```

Spam score handling:

```text
0–30 = low spam risk
31–60 = medium spam risk
61–100 = high spam risk
```

If spam score is missing:

```text
spamSafetyScore = 10
classificationConfidence is reduced
rationale includes "spam score missing"
```

---

# Confidence requirements

Each record must receive:

```text
classificationConfidence
evidenceClass
rationale
```

Use these confidence bands:

```text
0.85–1.00 = high confidence
0.70–0.84 = moderate confidence
0.50–0.69 = limited confidence
0.00–0.49 = directional only
```

Use these evidence classes:

```text
strongly_supported
supported
directional
insufficient_evidence
```

Do not invent certainty when evidence is missing.

---

# Artifact writer requirements

Implement artifact writing in:

```text
services\worker\src\adapters\dataforseo-backlinks\backlink-artifact-writer.js
```

Default local output path:

```text
artifacts\local\backlink-tests\
```

Write these files:

```text
raw-backlinks.json
normalized-backlinks.json
backlink-summary.json
```

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

For Phase 1, set:

```text
recommendedUse = contextual_report_only
```

---

# Runner requirements

Implement CLI runner in:

```text
services\worker\src\runners\run-backlink-test.js
```

It must support:

```text
--target
--competitors
--fixture
--out
```

Example:

```text
node services\worker\src\runners\run-backlink-test.js --target example.com --competitors competitor-a.com,competitor-b.com,competitor-c.com --fixture
```

The console summary must show:

```text
target domain
competitor domains
mode: fixture or live
total backlinks reviewed
good count
bad count
worth_pursuing count
ignored count
output path
recommended use
```

---

# Tests

Create tests in:

```text
services\worker\src\adapters\dataforseo-backlinks\backlink-adapter.test.js
```

The tests must verify:

```text
fixture mode works without DataForSEO credentials
good backlink classification works
bad backlink classification works
worth_pursuing classification works
ignore classification works
missing spam score reduces confidence
high spam score forces bad classification
footer/sidebar/widget placement prevents good classification
competitor overlap does not create worth_pursuing when spam score is high
artifact summary counts are correct
no production Vantage score files are modified by this adapter
```

Use the test framework already present in the repo. Do not add a new test framework unless no existing one exists.

If this is a fresh local rebuild repo with no test framework, use Node's built-in test runner first.

---

# Hard constraints

Do not modify:

```text
production audit orchestration
n8n webhook assumptions
Vantage readiness scoring
Vantage priority scoring
report generation
Netlify report rendering
Supabase schema
authentication
dashboard UI
AWS infrastructure
Railway deployment
```

Do not add database migrations.

Do not add frontend report panels yet.

Do not wire this into the main audit process yet.

This task is Phase 1 only.

---

# Verification commands

Run the most relevant existing test command for the worker.

Also run:

```text
npm run test:backlinks
```

Then run fixture mode manually:

```text
node services\worker\src\runners\run-backlink-test.js --target example.com --competitors competitor-a.com,competitor-b.com,competitor-c.com --fixture
```

---

# Final report required

When complete, report:

```text
Files created
Files modified
Package script added
Test command result
Fixture runner result
Output artifact paths
Whether any production Vantage score path changed
Whether any production audit pipeline changed
Git status
Commit hash if committed
```

Acceptance condition:

```text
PASS only if tests pass, fixture runner works, artifacts are written, and no live Vantage scoring or pipeline path changed.
```
