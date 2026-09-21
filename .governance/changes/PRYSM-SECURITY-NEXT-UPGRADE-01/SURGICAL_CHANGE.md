# Surgical Change Contract

1. Set the direct Next.js dependency to patched maintenance line `^15.5.24` (lock resolves `15.5.25`).
2. Override transitive PostCSS to `^8.5.23` (lock resolves `8.5.28`).
3. Await `params` in every dynamic App Router page/route and await `cookies()` at each material server-component/session read.
4. Preserve existing session validation, principal signing, worker calls, audit selection, route responses, and report HTML bytes.
5. Do not change worker/report logic or production configuration.

The candidate is not complete until the app production build, full worker/Whole-App closure, exact Preview, real authenticated browser route, and final artifact acceptance pass.
