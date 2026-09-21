# Surgical Change Contract

- Required outcome: preserve the dashboard return link in the authenticated browser and suppress it in browser print/PDF.
- Owning boundary: the reviewer-only HTML wrapper in `app/audits/[auditId]/report/[...path]/route.ts`.
- Hypothesis: adding the existing `no-print` class to the injected anchor activates the established print rule without changing screen styling or persisted artifact bytes.
- Permanent proof: focused route contract test asserts the injected link carries `no-print`; renderer contract proves `.no-print` is print-hidden; authenticated Chromium acceptance proves the computed print visibility and clean PDF.
- Protected: route authorization, principal and tenant identity, stored report bytes, all non-print navigation, report semantics, provider calls, production configuration.
- Reset after three failed repairs to this same root cause.
