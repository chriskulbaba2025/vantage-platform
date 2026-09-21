# PRYSM Next.js Security Upgrade — Intake

**Change ID:** PRYSM-SECURITY-NEXT-UPGRADE-01
**Starting candidate:** `45cb20d40b4d3d382503aef1ca179b3cd4b24e64`
**Tier:** T2 security/runtime and dependency change; staging confirmation is separately governed.

## Requested outcome

Preserve the authenticated PRYSM web and report flows while eliminating the critical/high dependency advisories observed in the authoritative Preview build. Production remains frozen.

## Scope

- Upgrade Next.js to the patched 15.5 maintenance line and pin PostCSS to a fully patched 8.5 release.
- Migrate App Router dynamic route params and request cookies to the asynchronous API contract required by Next 15.
- Preserve authentication principal, tenant, report, and rendering behavior.

## Explicitly out of scope

Worker/product report logic, schema, data, production configuration, production deployments, aliases, and paid/provider operations.
