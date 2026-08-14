# MT-IDENTITY-01 — Production Spine (frozen, pre-implementation)

**Release intent:** PRODUCTION_READY
**Frozen:** before identity implementation

## Current verified spine (evidence-traced)

```text
Browser (Vercel Next.js app, NO authentication layer)
  → app/api/* route handlers (server-side)
  → lib/worker-client.ts — TENANT_ID = process.env.VANTAGE_TENANT_ID || "default"
     (GLOBAL tenant assumption — every call carries the one env tenant)
  → worker server.js routes — tenantId = config.vantageTenantId (env)
  → auditService (createAudit/getAuditStatus/listAudits/submitReview/approveAudit/getReportPage)
  → lifecycle repository (PostgreSQL prysm.lifecycle_events.tenant_id TEXT)
  → governed artifact store (tenants/{tenantId}/clients/{clientId}/audits/{auditId}/...)
  → report proxy (reviewer HMAC cookie for draft states; approved/published public)
```

## Required production spine (post-implementation)

```text
Browser
  → authentication (Cognito User Pool via repository-owned identity boundary)
  → authenticated principal (verified JWT → stable cognito sub)
  → application user (prysm.users by cognito_sub)
  → tenant membership (prysm.tenant_memberships, role, status)
  → authorized tenant (server-side resolution ONLY — never browser input)
  → audit creation (persists resolved tenant)
  → audit listing/detail (tenant-scoped)
  → report authorization (role check BEFORE artifact retrieval)
  → artifact lookup (tenant-scoped key)
  → browser response (no report bytes before authorization)
```

## Producer → Contract → Consumer map

| # | Producer | Produced object/state | Contract | Validation point | Consumer | Failure result | Proof |
|---|---|---|---|---|---|---|---|
| 1 | Cognito User Pool | ID/access token (JWT) | OIDC/JWKS, iss+aud claims | verifyJwt at server boundary | identity provider boundary | 401, zero downstream access | TENANT-AUTH-01 |
| 2 | JWT verifier | AuthenticatedPrincipal { cognitoSub, email } | identity interface (Cognito adapter) | token verification before any lookup | session resolution | 401 fail closed | TENANT-AUTH-01/09 |
| 3 | users repository | PrysmUser { id, cognitoSub, status } | prysm.users row, status=active | lookup by cognito_sub | membership resolution | disabled → 401 | TENANT-AUTH-09 |
| 4 | memberships repository | TenantMembership { tenantId, role, status } | prysm.tenant_memberships, status=active | membership lookup after user | authorized tenant set | no active membership → non-disclosing 404 | TENANT-AUTH-02/03 |
| 5 | authorized tenant resolver | AuthorizedTenant { tenantId, roles[] } | server-side only; never browser input | route guard before worker call | worker client (tenant header) | forged tenant → 404/403 | TENANT-AUTH-10/11 |
| 6 | audit creation (worker) | auditRequest.tenantId = resolved tenant | audit-request.schema.json | persisted at creation | lifecycle repository | cross-tenant create → 403 | TENANT-AUTH-12 |
| 7 | audit listing/detail (worker) | tenant-scoped rows | listByTenant(authTenant) | membership check before query | web list/detail pages | other-tenant audit → 404 | TENANT-AUTH-02/03/13 |
| 8 | report authorization (web+worker) | role ∈ {reviewer, tenant_admin, platform_admin} for drafts; viewer+ for approved | reviewer-auth + tenant guard | BEFORE artifact get | report proxy | no bytes; 403/404 | TENANT-AUTH-04/05/14 |
| 9 | artifact store | bytes at tenants/{authTenant}/... | governed key with resolved tenant | after authorization | browser response | no key guessing bypass | TENANT-AUTH-14/15 |

## Tenant acceptance contract (frozen IDs)

TENANT-AUTH-01 … TENANT-AUTH-16 as specified in the work directive, plus:

- TENANT-AUTH-17: multi-tenant user — same user, two active memberships → each tenant scope works; no cross-bleed.
- TENANT-AUTH-18: tenant switch via browser-supplied header/query/body → ignored/denied.
