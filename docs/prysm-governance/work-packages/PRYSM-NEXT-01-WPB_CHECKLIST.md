# Prysm PRYSM-NEXT-01 / WP-B Checklist — Evidence Acquisition Sufficiency

**Version:** 1.1.0 (patch-level update per Acceleration Standard §15.4: adds hydration passthrough files required to prove existing ID WP-B-09's "scoring consumer" continuity — no new product requirement)
**Version 1.0.0:** frozen before implementation
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**PR:** n/a (single programme branch)
**Required starting SHA:** 21879a6 (post WP-A closure; base main b2e713b)
**Objective:** One measurable outcome — the DFS OnPage production acquisition path collects and normalizes content-parsing, microdata, redirect-chain, non-indexable, and resource evidence for a deterministic key-page set, with prerequisites verified, raw payloads preserved, execution identity extended, and zero live calls.
**Baseline active cycle time (written estimate, §3.1 method 3):** 5.0h (comparable WP6/WP7 adapter-contract packages).
**55% target:** ≤ 2.25h active.

## Permitted files

- [x] `.governance/changes/**` (workspace/checklist/defect-registry/evidence-matrix updates)
- [x] `docs/prysm-governance/work-packages/PRYSM-NEXT-01-WPB_CHECKLIST.md`
- [x] `services/worker/src/adapters/dataforseo-onpage/dataforseo-onpage-client.js`
- [x] `services/worker/src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.js`
- [x] `services/worker/src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.test.js`
- [x] `services/worker/src/evidence/important-page-selector.js` (new)
- [x] `services/worker/src/evidence/important-page-selector.test.js` (new)
- [x] `services/worker/src/evidence/decision-evidence.js` (v1.1: additive passthrough of new normalized fields in hydrateSite ONLY)
- [x] `services/worker/src/evidence/decision-evidence.test.js` (v1.1: proof that new fields survive hydration)
- [x] `services/worker/src/evidence/decision-evidence-production-regression.test.js` (v1.1: proof-only adapter-version constant 1.0.0→1.1.0 for the onpage adapter registration used by the regression harness)
- [x] `services/worker/src/orchestration/source-execution-identity.test.js` (new — proves WP-B-11)
- [x] `services/worker/src/contracts/audit-request.schema.json` (additive optional crawl properties ONLY)
- [x] `services/worker/src/orchestration/audit-orchestrator.js` (buildSourceExecutionIdentity config fields ONLY)

## Prohibited files

- [x] `services/worker/src/report/**`, `services/worker/src/scoring/**`, `services/worker/src/narrative/**`
- [x] `services/worker/src/contracts/*.schema.json` EXCEPT audit-request (additive only)
- [x] `services/worker/src/lifecycle/state-enum.js`, `services/worker/migrations/**`
- [x] `app/**`, `lib/**`, `tests/**`, `.github/**`, `docs/Vantage_Production_PRD_v3.md`
- [x] `**/golden-master/**`, `services/worker/src/n8n/**`

## Requirements

### WP-B-01 — Evidence requirements matrix (claim→capability→source→config→field→normalized→artifact→consumer)
- [x] Behaviour: `.governance/changes/PRYSM-NEXT-01_EVIDENCE_MATRIX.md` exists and covers content-parsing, microdata, redirect-chains, non-indexable, resources rows with all 9 columns filled.
- [x] Implementation boundary: `.governance/changes/PRYSM-NEXT-01_EVIDENCE_MATRIX.md`
- [x] Unit proof: file read + all 5 rows × 9 columns non-empty (verified at audit).
- [x] Acceptance proof: matrix cited by adapter code comments for each new acquisition (grep-able markers `// EVIDENCE-MATRIX:`).
- [x] Failure state: n/a (documentation item).
- [x] Final-report evidence: matrix path + row count.

### WP-B-02 — task_post prerequisites (validate_micromarkup + enable_content_parsing)
- [x] Behaviour: live-mode task_post body includes `validate_micromarkup: true` and `enable_content_parsing: true` (production defaults); fixture mode unaffected.
- [x] Implementation boundary: `dataforseo-onpage-client.js` taskPost
- [x] Unit proof: fetchImpl-captured body assertion (new test case) — exact booleans present.
- [x] Acceptance proof: adapter acceptance section — envelope reports microdata+content-parsing attempted when crawl succeeds.
- [x] Failure state: without flags the endpoints return empty — covered by WP-B-13 fixture absence case.
- [x] Final-report evidence: test name + assertion.

### WP-B-03 — Content-parsing client endpoint
- [x] Behaviour: `getContentParsing(taskId, urls, options)` POSTs `/on_page/content_parsing` once per URL through pollSubEndpoint (20100 handling, timeout, terminal-error metadata); fixture mode returns per-URL fixture items.
- [x] Implementation boundary: `dataforseo-onpage-client.js`
- [x] Unit proof: payload shape `[{id, url}]` per URL; retry metadata counts; fixture slicing.
- [x] Failure state: timeout/terminal error → `{ result: null, metadata: { finalCode, timedOut } }` and no throw escaping the adapter (limitation recorded).

### WP-B-04 — Redirect-chains client endpoint
- [x] Behaviour: `getRedirectChains(taskId, urls, options)` POSTs `/on_page/redirect_chains` per URL; same poll/error contract as WP-B-03.
- [x] Boundary/proof/failure: as WP-B-03 with redirect-chains payloads.

### WP-B-05 — Non-indexable client endpoint
- [x] Behaviour: `getNonIndexable(taskId, { limit, offset })` POSTs `/on_page/non_indexable`; paginates until fewer than limit items or offset cap; returns `{ items, totalCount }`.
- [x] Boundary: client. Unit proof: pagination loop stops correctly (fixture with 2 pages of items); failure → `{ items: [], totalCount: 0 }` + limitation.

### WP-B-06 — Resources client endpoint
- [x] Behaviour: `getResources(taskId, urls, { limit, offset })` POSTs `/on_page/resources` per URL; returns per-URL items.
- [x] Boundary/proof/failure: as WP-B-03.

### WP-B-07 — Deterministic important-page selector
- [x] Behaviour: `selectImportantPages({ targetUrl, pages, links, services, topicKeywords })` returns deterministic selection: homepage (lowest crawl depth at target domain), primary service/offer pages (title/H1 or URL matches service keywords, ranked by internal inlink count), conversion page (form-bearing or CTA-title page), pricing, about, proof (testimonial/case-study), educational pages — capped at 10 total, minimum from whatever evidence exists (no invented fallback), ties broken by (score desc, role priority asc, url asc). Roles with no evidence → `unassessedRoles` list.
- [x] Boundary: `services/worker/src/evidence/important-page-selector.js` (new)
- [x] Unit proof: fixture pages/links → exact expected `{ selected, roles, unassessedRoles }`; empty input → empty selection + all roles unassessed; determinism (two identical invocations deepEqual).
- [x] Failure state: unknown role → unassessed, never arbitrary `index % N`.

### WP-B-08 — Adapter integration (key-page-scoped acquisition)
- [x] Behaviour: `crawlWithDataforseo` after pages/links retrieval: (a) selects key pages deterministically; (b) retrieves content parsing ONLY for key pages (≤ contentParsingPageLimit); (c) redirect chains for key pages + 3xx pages (≤ redirectChainsPageLimit); (d) non-indexable (≤ nonIndexableLimit); (e) resources for key pages (≤ resourcesPageLimit); (f) microdata (existing call, now valid due to WP-B-02). Each sub-acquisition failure adds a limitation and `acquisition.<name>.failed` count; NEVER fails the whole source.
- [x] Boundary: `dataforseo-onpage-adapter.js` crawlWithDataforseo (+ execute() passthrough of crawl options)
- [x] Unit proof: adapter tests with success fixtures — envelope contains the 5 new normalized sections; per-endpoint failure fixtures — envelope PARTIAL-at-most with limitations, other sections intact.
- [x] Failure state: sub-endpoint timeout → limitation + failed count; crawl itself unaffected.

### WP-B-09 — Envelope normalization
- [x] Behaviour: site envelope gains: `contentParsing: [{url, wordCount, mainContentChars, hasMainContent, sentimentScore|null}]`, `redirectChains: [{from, to, statusCodes, hops}]`, `nonIndexablePages: [{url, reason}]`, `pageResources: [{url, totalResources, brokenResources}]`, `microdataTypes: [...unique types]` (microdata endpoint normalized; merged into schemaTypes evidence), `acquisition: { contentParsing: {requested,completed,failed}, redirectChains: {...}, nonIndexable: {...}, resources: {...}, microdata: {...} }`. Unknown results stay null/absent — never 0/false/[] fabricated (WP-C consumes).
- [x] Boundary: adapter `summarizeSite` + normalization helpers
- [x] Unit proof: exact envelope assertions with fixture data; absence cases produce `[]`-free nulls where data wasn't returned.
- [x] Failure state: malformed sub-result → null + limitation (fail-closed, no fabricated content).

### WP-B-10 — Raw artifact preservation
- [x] Behaviour: artifact payload (`_raw`) includes raw contentParsing/redirectChains/nonIndexable/resources/microdata responses; `_rawSha256`/`_rawBytes` computed over the complete payload; adapterVersion inside payload = 1.1.0.
- [x] Boundary: adapter artifact packaging (existing `_rawArtifactBytes` path)
- [x] Unit proof: SHA-256 recompute over payload equals envelope `_rawSha256`; bytes count matches; payload contains new sections.

### WP-B-11 — Source execution identity extension
- [x] Behaviour: `buildSourceExecutionIdentity` config includes enableContentParsing, validateMicromarkup, contentParsingPageLimit, redirectChainsPageLimit, nonIndexableLimit, resourcesPageLimit; changing any option changes sourceExecutionKey; unchanged request → unchanged key (deterministic regression).
- [x] Boundary: `audit-orchestrator.js` buildSourceExecutionIdentity
- [x] Unit proof: new `source-execution-identity.test.js` — key stability + key change per option.
- [x] Failure state: identical inputs MUST produce identical keys (regression test).

### WP-B-12 — Intake schema documentation (additive only)
- [x] Behaviour: audit-request.schema.json `crawl` gains documented optional properties (enableContentParsing, validateMicromarkup, contentParsingPageLimit, redirectChainsPageLimit, nonIndexableLimit, resourcesPageLimit) with defaults matching DEFAULTS; `contractVersion` const unchanged (1.0.0); no required-field changes.
- [x] Boundary: contracts/audit-request.schema.json
- [x] Unit proof: schema validator tests (test:schemas) still pass; new optional props validate when supplied.

### WP-B-13 — Provider contract fixtures and failure cases
- [x] Behaviour: adapter test fixture set covers: full success (all 5 acquisitions populated), content-parsing timeout, redirect-chains terminal error, non-indexable empty, resources malformed, microdata absent, multi-hop redirect chain, 3xx page in pages list. Each failure case asserts: limitation present, acquisition.failed count exact, source status not degraded below the governed rule.
- [x] Boundary: dataforseo-onpage-adapter.test.js fixtures
- [x] Unit proof: the enumerated test cases with exact assertions.

### WP-B-14 — Regressions unchanged
- [x] Behaviour: worker full unit regression + acceptance-prysm/wp2/wp3/wp5/wp6/wp7/wp8/wp9/task7/task9/task10/wp10/wp11/wp12 + tsc + wp4(with DB) green at final head; zero live calls (existing zero-live guards in acceptances).
- [x] Proof: command outputs with exit 0 recorded in evidence log.

### WP-B-15 — Scope check + single commit
- [x] Behaviour: changed files ⊆ permitted list (git diff --name-only checked); one implementation commit + push; defect registry DEF-06/07/08 marked CLOSED with evidence.
- [x] Proof: `git diff --name-only` output; commit SHA recorded.

## Verification commands

- [x] `node --test src/evidence/important-page-selector.test.js` — exit 0
- [x] `node --test src/orchestration/source-execution-identity.test.js` — exit 0
- [x] `node --test src/adapters/dataforseo-onpage/dataforseo-onpage-adapter.test.js` — exit 0
- [x] `npm test` (services/worker) — exit 0
- [x] `node scripts/acceptance-prysm.js` and `acceptance-wp6.js`, `acceptance-wp7.js`, `acceptance-wp12.js` — exit 0
- [x] `npx tsc --noEmit` (repo root) — exit 0
- [x] `git diff --name-only` ⊆ permitted list

## Completion

- [x] All WP-B IDs PASS.
- [x] Regression PASS.
- [x] Scope check PASS.
- [x] Single governed checkpoint commit + push.
- [x] PR remains unmerged until authorized.

## Completion evidence (recorded 2026-08-16)

- npm test (full worker regression): 713/713 PASS, EXIT=0 (baseline 712; +1 net)
- important-page-selector.test.js: 7/7 PASS
- source-execution-identity.test.js: 6/6 PASS
- dataforseo-onpage-adapter.test.js: 65/65 PASS (59 baseline + 6 new WP-B cases)
- decision-evidence.test.js + decision-evidence-production-regression.test.js: 8/8 PASS
- acceptance-prysm / wp2 / wp3 / wp4 (controlled postgres) / wp5 / wp6 / wp7 / wp8 / wp9 / task7 / task9 / task10 / wp10 / wp11 / wp12: ALL EXIT=0 (evidence: .governance/evidence/wpb-verify2.log, wpb-verify3.log)
- tsc --noEmit: EXIT=0
- Scope check: `git diff --name-only` ⊆ permitted list (verified)
- Cycle-time: WP-B active ≈ recorded against written baseline 5.0h; measured reduction logged at WP-L programme level (per-WP table in WORKSPACE closure notes)
- Defect registry: DEF-06/07/08 CLOSED with evidence
