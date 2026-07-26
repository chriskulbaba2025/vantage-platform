## Vantage Platform Current Status

Authoritative specification:

- docs/Vantage_Production_PRD_v3.md

Completed:

- Task 1: PageSpeed live access verified
- Task 2: V3 canonical source-status and evidence contracts merged in PR #4
- Task 3: DataForSEO On-Page adapter merged in PR #5
- Task 4: Production crawling switched from legacy crawler to DataForSEO as part of PR #5

Railway variables configured:

- GOOGLE_PAGESPEED_API_KEY
- VANTAGE_WEBHOOK_SECRET
- DATAFORSEO_LOGIN
- DATAFORSEO_PASSWORD

Current task:

- Do not begin the next task. Main is current and clean.

Execution rules:

- Read the full PRD before changing code.
- Implement one task at a time.
- Do not begin the next task.
- Audit the final diff against the PRD.
- Fix defects before reporting completion.
- Run the full test suite and verification.
- Do not commit or push until explicitly instructed.
- Do not change reporting logic unless required by PRD v3 or a proven defect.
