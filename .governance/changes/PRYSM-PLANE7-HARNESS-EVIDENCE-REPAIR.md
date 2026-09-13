# PRYSM Plane 7 Harness Evidence Repair

Change tier: `T2_BOUNDARY`

Scope is restricted to `services/worker/scripts/plane7-production-confirmation.mjs`, its focused deterministic test, and this governance record. No application runtime, provider adapter, deployment, or production configuration is changed.

The harness contract is fail-closed before any future create request. It requires candidate identity, intended and actual path, exact entry point, authentication mode, tenant-resolution mechanism, and an explicit `productionPathEquivalence: PASS`. Browser/principal and internal-secret paths are distinct and cannot be relabelled.

Evidence records contain safe header-presence booleans, never raw secrets/tokens, and preserve candidate/deployment/timestamp/path/auth/tenant/client/audit/execution/lifecycle/timeout/terminal/artifact data. Records are written with exclusive-create semantics so an existing evidence file cannot be overwritten.

The timeout contract computes the ceiling from source policy and retry attempts. An unchanged `collecting` state is `NOT_STALLED` until the ceiling is reached, unless direct termination/failure evidence exists.

No future production confirmation is authorized by this change. A human-authorized caller must supply the production execution seam after the preflight passes.

