# PRYSM-SEMANTIC-CONTRACT-CLOSURE-01

Release intent: STAGING_READY
Starting SHA: `a084503526d15d57e8d41eaef6588ac2d8af54ae`

Production spine: intake -> source execution -> SourceResult -> DecisionEvidence -> CapabilityEvidence -> findings/scoring -> ReportContent -> view model -> seven-page report.

Frozen requirements:
- SC-01 viable source + unknown content marker remains limited, never false-unavailable.
- SC-02 zero usable backlink records are UNAVAILABLE/no_data, never AVAILABLE.
- SC-03 source status and limitation survive canonical evidence.
- SC-04 deterministic scoring/report/tenant/lifecycle invariants remain unchanged.
- SC-05 no live paid calls in proof.
- SC-06 closure gate and exact-head CI pass before staging-ready claim.

Acceptance: controlled unknown marker yields PARTIAL with limitation; controlled zero-record backlink response cannot yield AVAILABLE; terminal verification is `npm run verify:prysm-closure` plus exact-head CI.
