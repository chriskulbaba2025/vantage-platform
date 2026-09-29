# Constraints

- No production mutation without explicit authorization.
- Zero live paid provider/model calls in tests and CI.
- Preserve seven-page report structure, deterministic scoring, tenant isolation, lifecycle state machine, and approved-report immutability.
- Preserve UNKNOWN/PARTIAL semantics; no false zero, false absence, or fabricated success.
- Repairs must generalize to arbitrary valid audits.
- Exact-head CI and governed acceptance are required before STAGING_READY.
- Do not hand repository-controlled or tool-accessible work back to the user.
- Do not provide a Codex prompt or manual command as a substitute for execution available to the current executor.
- Before handoff, record proof that CURRENT ENVIRONMENT CANNOT EXECUTE THE NEXT REQUIRED ACTION.
- Continue through bounded repair and whole-system verification until terminal PASS or one proven external HOLD.
