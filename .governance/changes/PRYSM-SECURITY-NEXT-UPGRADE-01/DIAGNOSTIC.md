# Diagnostic Evidence

**Classification:** VERIFIED_ROOT_CAUSE plus VERIFIED_FRAMEWORK_CONTRACT_GAP.

- Authoritative Vercel `prysm` Preview build for source `45cb20d` reported Next.js `14.2.35` and 2 npm vulnerabilities (1 high, 1 critical).
- Local `npm audit --audit-level=high` reproduced the vulnerable dependency graph.
- Patching to Next `15.5.25` and PostCSS `8.5.28` yields zero vulnerabilities in both full and production-only npm audits.
- The first Next 15 build identified synchronous dynamic route params. The next type check identified synchronous `cookies()` use in the audit page. Read-only source inventory also found the same cookie read in `lib/identity/session.ts` and root layout; all were included in the framework migration.
- A build under the inherited nonstandard `NODE_ENV` failed while prerendering Next's not-found path. Re-running under `NODE_ENV=production` passed. Vercel uses the production build mode; no product behavior change was made for this local environment variable.

No report semantics or worker logic were changed.
