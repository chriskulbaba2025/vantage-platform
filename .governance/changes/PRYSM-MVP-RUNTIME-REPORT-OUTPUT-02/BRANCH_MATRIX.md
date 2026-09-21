# Change Branch Coverage Matrix

| ID | Material condition | Contract / handoff | Deterministic assembled proof | Status |
|---|---|---|---|---|
| RPT-OUT-01 | Multiple visible accepted priority groups; source ranks contain a gap after filtering | Accepted priority unit list → Priority Fixes display | `S02B` sparse source rank regression asserts contiguous visible labels while preserving canonical order; CR-43 covers all render branches | MAPPED_AND_PASS after exact-candidate run |
| RPT-OUT-02 | Shared Trust message and verdict are semantically identical | Narrative-state projection → Trust section verdict | `TRUST-WORDING-01` asserts one visible occurrence on the full real renderer; CR-43 covers all render branches | MAPPED_AND_PASS after exact-candidate run |
| RPT-OUT-03 | Shared Trust message is absent; fallback verdict is required | Missing optional narrative → Trust section fallback | `TRUST-WORDING-02` invokes production Trust section and asserts fallback verdict | MAPPED_AND_PASS after exact-candidate run |
| RPT-OUT-04 | Real authenticated reviewer reads persisted exact audit and report | Cognito/browser → Vercel → Railway auth/membership/Postgres → S3 → browser | Real Chromium acceptance on exact deployed candidate, including refresh and dashboard return | UNEXECUTED on corrected candidate |
| RPT-OUT-05 | Each selected report page is printed as client output | Browser viewer selected page → print CSS → PDF | Seven selected-page browser-generated PDFs, joined in viewer order, text and rendered-page inspection | UNEXECUTED on corrected candidate |

The repository-level Whole-App branch matrix P-B01 through P-B16 remains authoritative and unchanged by this presentation-only correction; the exact-candidate closure gate must execute it.
