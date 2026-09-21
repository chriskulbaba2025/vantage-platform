# Material Branch Matrix

| Branch | Changed boundary | Candidate proof |
|---|---|---|
| Login/session cookie | `cookies()` is asynchronous; same session token verifier | production build; real Chromium login and refresh |
| Dashboard and audit detail | dynamic `params` plus authenticated principal | production build; exact audit detail browser path |
| Report redirect | dynamic `params`; reviewer/principal gates unchanged | production build; report navigation in Chromium |
| Report artifact proxy | catch-all params and identity-before-artifact path | production build; exact persisted report retrieval and hash |
| Approval/review/resume APIs | dynamic route context only | production build; existing worker suites; no mutation invoked |
| Narrative review API | async dynamic params; no Writer/Judge call made | production build; existing worker suites; no mutation invoked |
| Worker regression | no worker source changes | complete closure gate |
