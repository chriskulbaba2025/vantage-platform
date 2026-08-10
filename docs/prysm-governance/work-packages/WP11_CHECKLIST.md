# Prysm WP11 Checklist — Web App Integration

**Version:** 1.0.0
**Branch:** feat/prysm-wp11-web-app-integration
**PR:** TBD
**Required starting SHA:** a9dcd2ed8dd4c21b5db491aa3b13a9bf6a5aa020
**Objective:** Build the governed Next.js + React + TypeScript web application at repository root with server-side worker API integration, database-backed history, review/approval UI, and approved report viewer — all using the WP4-WP10 governed stack.
**Baseline active cycle time:** 1.9h
**55% target active cycle time:** 0.86h

## Permitted files

- [ ] `CLAUDE.md` — WP11 status metadata
- [ ] `docs/prysm-governance/work-packages/WP11_CHECKLIST.md`
- [ ] `package.json` (root)
- [ ] `package-lock.json` (root)
- [ ] `next.config.*`
- [ ] `tsconfig.json`
- [ ] `app/**`
- [ ] `components/**`
- [ ] `lib/**`
- [ ] `tests/wp11/**`
- [ ] `playwright.config.*`
- [ ] `scripts/wp11-*.mjs`
- [ ] `services/worker/src/server.js`
- [ ] `services/worker/src/application/**`
- [ ] `services/worker/src/lifecycle/postgres-repository.js`
- [ ] `services/worker/src/lifecycle/lifecycle-service.js`
- [ ] `services/worker/migrations/002_wp11_web_app_integration.sql`
- [ ] `services/worker/test-fixtures/wp11/**`
- [ ] `services/worker/scripts/acceptance-wp11.js`
- [ ] `services/worker/scripts/wp11-preflight.js`
- [ ] `services/worker/scripts/wp11-scope-check.js`
- [ ] `services/worker/scripts/wp11-verify.js`
- [ ] `services/worker/package.json`
- [ ] `services/worker/package-lock.json`
- [ ] `.github/workflows/worker-ci.yml`

## Prohibited / READ-ONLY

- [ ] `services/worker/src/contracts/**`
- [ ] `services/worker/src/report/**`
- [ ] `services/worker/src/report-content/**`
- [ ] `services/worker/src/report-view-model/**`
- [ ] `services/worker/src/narrative/**`
- [ ] `services/worker/src/n8n/**`
- [ ] `services/worker/src/scoring/**`
- [ ] `services/worker/src/adapters/**`
- [ ] `services/worker/src/orchestration/audit-orchestrator.js`
- [ ] `services/worker/src/storage/artifact-key.js`
- [ ] `services/n8n/**`
- [ ] `report-golden-master/**`
- [ ] `railway.toml`
- [ ] `services/worker/Dockerfile`
- [ ] credential/environment files
- [ ] WP0-WP10 checklist semantics

---

## Requirements

### WP11-PIPE-01 — Governed production audit path

- [ ] Behaviour: A web-created audit executes the real WP4-WP10 governed AuditOrchestrator path and persists lifecycle state through the existing lifecycle service. The web path must never invoke legacy runAudit() as its execution engine.
- [ ] Implementation boundary: `services/worker/src/application/audit-service.js`, `services/worker/src/server.js`
- [ ] Unit proof: orchestrator.execute() called exactly once per audit creation; legacy runAudit call count = 0 on WP11 path.
- [ ] Acceptance proof: Full lifecycle from CREATED → DRAFT_RENDERED through actual orchestrator. Exact ordered lifecycle history asserted.
- [ ] Failure state: Invalid request → VALIDATION_FAILED. Duplicate idempotency key → one audit.
- [ ] Prohibited later events/calls/writes: No legacy runAudit invocation. No direct adapter calls outside orchestrator.

### WP11-INTAKE-01 — URL and business intake

- [ ] Behaviour: Web form accepts target URL, business name, market/location, language, primary goal, services/offers. Required fields reject empty/malformed values. Submission creates schema-valid AuditRequest v1.0.0.
- [ ] Implementation boundary: `app/audits/new/page.tsx`, `lib/audit-request.ts`
- [ ] Unit proof: Empty URL rejected. Empty business name rejected. Valid submission produces correct AuditRequest shape with UUID auditId and stable idempotencyKey.
- [ ] Acceptance proof: Form submission → schema-valid AuditRequest → orchestrator receives correct fields.
- [ ] Failure state: Empty URL → form validation error, no API call. Empty business name → form validation error.
- [ ] Prohibited later events/calls/writes: tenantId never from browser input. customRobotsTxt never in UI.

### WP11-COMP-01 — Competitor intake

- [ ] Behaviour: UI accepts zero through three competitor URLs. Four competitors rejected. Invalid URLs rejected. Accepted URLs reach AuditRequest.competitors. Empty → [].
- [ ] Implementation boundary: `app/audits/new/page.tsx`, `lib/audit-request.ts`
- [ ] Unit proof: 0 competitors → []. 3 valid URLs → all present. 4 URLs → rejected. Invalid URL → rejected.
- [ ] Acceptance proof: Competitor URLs in form → exact same URLs in AuditRequest.competitors array.
- [ ] Failure state: 4 competitors → form validation error. "not-a-url" → form validation error.

### WP11-ANALYTICS-01 — GA4/GSC selection

- [ ] Behaviour: Optional GA4 propertyId (digits only), optional GSC siteUrl (URL-prefix/sc-domain forms). Leaving unselected doesn't block creation.
- [ ] Implementation boundary: `app/audits/new/page.tsx`, `lib/audit-request.ts`
- [ ] Unit proof: GA4 with non-digit chars rejected. GSC with invalid URL rejected. No selection → fields absent from AuditRequest.
- [ ] Acceptance proof: GA4 propertyId "123456789" → reaches AuditRequest.ga4.propertyId. GSC "sc-domain:example.com" → reaches AuditRequest.gsc.siteUrl.
- [ ] Failure state: GA4 "abc123" → validation error. GSC empty string → ignored.

### WP11-STATUS-01 — Audit and source status

- [ ] Behaviour: UI displays exact canonical lifecycle state from database. Displays all 7 canonical source statuses. Missing evidence remains visibly missing.
- [ ] Implementation boundary: `app/audits/[auditId]/page.tsx`, `lib/worker-client.ts`
- [ ] Unit proof: lifecycle state "draft_rendered" → displays "Draft Rendered". Source status "PARTIAL" → displays with limitation.
- [ ] Acceptance proof: Exact status values from worker API → rendered in UI without transformation.
- [ ] Failure state: Unknown status → displayed verbatim, not mapped to success/error.

### WP11-HISTORY-01 — Database-backed audit history

- [ ] Behaviour: Tenant-scoped PostgreSQL query returns only requesting tenant's audits, newest first. Each row has auditId, clientId, business name, target URL, created timestamp, latest lifecycle state, last-updated timestamp.
- [ ] Implementation boundary: `services/worker/src/lifecycle/postgres-repository.js`, `services/worker/src/application/audit-service.js`
- [ ] Unit proof: Query tenant-A → only tenant-A audits. Query tenant-B → zero tenant-A results. Cross-tenant returns empty.
- [ ] Acceptance proof: Two audits created for tenant-A, one for tenant-B → tenant-A history returns 2, tenant-B returns 1. History populated from PostgreSQL, not filesystem/S3/localStorage.
- [ ] Failure state: Cross-tenant query → 0 results for other tenant.

### WP11-REVIEW-01 — Draft review

- [ ] Behaviour: DRAFT_RENDERED audits expose review endpoint. UI displays governed checklist. Complete review → in_review. Incomplete review rejected. Review record persisted in PostgreSQL.
- [ ] Implementation boundary: `services/worker/src/application/audit-service.js`, `app/audits/[auditId]/page.tsx`
- [ ] Unit proof: Complete checklist → transition to in_review. Partial checklist → rejected. Review row in PostgreSQL.
- [ ] Acceptance proof: Exact lifecycle: draft_rendered → in_review. Review record in PostgreSQL with reviewer, reviewedAt, checklist. Approval not possible from draft_rendered.
- [ ] Failure state: Incomplete checklist → 422. Missing reviewer → 422.

### WP11-APPROVAL-01 — Approval action

- [ ] Behaviour: Only fully reviewed audit may be approved. in_review → approved. Approver identity required. Approval record in PostgreSQL.
- [ ] Implementation boundary: `services/worker/src/application/audit-service.js`, `app/audits/[auditId]/page.tsx`
- [ ] Unit proof: Reviewed audit + approver → approved. Non-reviewed → rejected. Missing approver → rejected.
- [ ] Acceptance proof: Exact lifecycle: in_review → approved. Approval row in PostgreSQL.
- [ ] Failure state: Non-reviewed approval → 422. Missing approver → 422.

### WP11-VIEW-01 — Approved report viewer

- [ ] Behaviour: Serve WP10 report artifacts only when APPROVED or PUBLISHED. Draft/Review → 403. Path traversal rejected. Pages read through governed artifact store.
- [ ] Implementation boundary: `app/audits/[auditId]/report/[...path]/route.ts`, `lib/worker-client.ts`
- [ ] Unit proof: APPROVED → 200 with HTML. DRAFT_RENDERED → 403. IN_REVIEW → 403. PUBLISHED → 200. Path traversal → 400.
- [ ] Acceptance proof: Exact HTTP status codes for each lifecycle state. Page bytes and SHA match WP10 artifact store. Existing report navigation and print controls unchanged.
- [ ] Failure state: "../etc/passwd" → 400. Unknown file → 404. Non-approved state → 403.

### WP11-WEB-01 — Vercel web interface

- [ ] Behaviour: Functional routes: /, /audits/new, /audits/[auditId], /audits/[auditId]/report. Browser accesses worker through Next.js Route Handlers only. No secrets in client bundles. Production Next.js build succeeds.
- [ ] Implementation boundary: Next.js app at repo root, `app/**`, `components/**`
- [ ] Unit proof: next build exits 0. Client bundle has 0 credential-containing strings.
- [ ] Acceptance proof: All routes load. Worker secret absent from client JS. No NEXT_PUBLIC_* contains credential.
- [ ] Failure state: Worker secret in client bundle → FAIL. Build failure → FAIL.

### WP11-FLOW-01 — Full flow without shell access

- [ ] Behaviour: Full user flow: create audit → observe lifecycle → review → approve → view report → history. No shell commands between steps.
- [ ] Implementation boundary: `tests/wp11/full-flow.spec.ts`, `scripts/acceptance-wp11.js`
- [ ] Unit proof: N/A (integration-level).
- [ ] Acceptance proof: Acceptance script exercises all 18 steps through HTTP endpoints. Each step asserts exact observable state.
- [ ] Failure state: Any step requiring manual intervention → FAIL.

### WP11-SEC-01 — Server-only privileged access

- [ ] Behaviour: Worker/API credential server-side only. Provider tokens, OAuth secrets, DB credentials never in API responses, HTML, or browser JS. Tenant identity injected server-side.
- [ ] Implementation boundary: `lib/worker-client.ts`, `app/**/route.ts`
- [ ] Unit proof: Secret scan on client bundle → 0 matches. API responses contain 0 credential keys.
- [ ] Acceptance proof: Worker secret count in client JS = 0. DB credential count in API response = 0. Tenant override via browser payload = rejected.
- [ ] Failure state: Any credential in client bundle → FAIL.

### WP11-ZERO-01 — Zero live paid calls

- [ ] Behaviour: WP11 tests and acceptance: live provider calls = 0, live LLM calls = 0, live n8n calls = 0, live cost = $0.00.
- [ ] Implementation boundary: All WP11 modules.
- [ ] Unit proof: Acceptance runs with controlled mock adapters.
- [ ] Acceptance proof: Acceptance suite verifies zero live calls.

### WP11-LOCK-01 — Report immutability

- [ ] Behaviour: Zero-byte changes to services/worker/src/report/** and report-golden-master/**. WP10 renderer/design hashes equal starting SHA baseline.
- [ ] Implementation boundary: Repository-wide diff.
- [ ] Unit proof: Git diff for report/ and golden-master/ is empty.
- [ ] Acceptance proof: WP10 LOCK-01 verification still PASS.

### WP11-REG-01 — Prior governed regression

- [ ] Behaviour: WP2-WP10 acceptance remains PASS. Full worker regression PASS. Schema/artifact/lifecycle/PostgreSQL tests PASS.
- [ ] Implementation boundary: All existing modules.
- [ ] Acceptance proof: `npm run wp11:verify` exits 0 with all prior suites green.

### WP11-SCOPE-01 — Exact scope

- [ ] Behaviour: Only frozen permitted files changed. No generated artifacts committed. No credentials. No Vercel/Railway config mutation. No WP12 work.
- [ ] Implementation boundary: Repository-wide diff.
- [ ] Acceptance proof: `npm run wp11:scope-check` exits 0.

---

## Verification commands

- [ ] `npm run wp11:preflight` — branch/SHA/clean-tree
- [ ] `npm run test:wp11` — WP11 unit tests
- [ ] `npm run acceptance:wp11` — WP11 acceptance
- [ ] `npm run wp11:scope-check` — permitted/prohibited file check
- [ ] `npm run wp11:verify` — full WP11 verification
- [ ] `npm test` (services/worker) — full worker regression
- [ ] `npm run build` (root) — production Next.js build

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
