# Material Branch Matrix

| Branch ID | Material branch | Executing code | Positive proof | Negative proof |
|---|---|---|---|---|
| VIEW-PRIMARY | Six primary report pages | Seven-page v2 renderer | All six titles present and page content selected by navigation | No raw state/status/jargon in visible primary-page text |
| VIEW-TRUST | Trust section calls shared detail renderer | `eeatSection` → `narrativeStateBlock` | Trust narrative and next step visible | State enum and “Bounded action” absent |
| VIEW-SUPPORT | Supporting evidence details | evidence limitations, capability rows, status trace | Every capability remains associated with its specific label | No duplicate lab/field label or raw source enum in client copy |
| EVIDENCE-STATUS | AVAILABLE/PARTIAL/UNAVAILABLE/UNKNOWN | client status mapper | Distinct mapped descriptions | No enum flattening or unavailable-to-absence inference |
| PRINT-SELECTED | Current selected conceptual page only | frozen viewer print CSS | Each of seven selected pages prints its content | Other page content and navigation are hidden from each page PDF |
| IDENTITY-STAGING | Authenticated browser audit/report read | Vercel Preview → GENSEN staging → Postgres/S3 | Exact principal/audit/client/artifact path | No default, anonymous, wrong-tenant, or stale artifact substitution |
