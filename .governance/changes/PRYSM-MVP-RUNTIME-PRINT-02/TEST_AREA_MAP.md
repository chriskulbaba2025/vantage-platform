# Test Area Map

| Area | Boundary | Required proof |
|---|---|---|
| Renderer contract | `render-report-v2.js` print CSS | Worker renderer test asserts active view permits page fragmentation |
| Seven selected views | Executive, priorities, journey, content, trust, competitor, supporting | Exact-candidate Chromium PDF from each selected view |
| Client report semantics | Persisted audit 6dca53ed-ae00-484c-bf77-b59c059eef51 | Seven-page browser review; existing accepted-priority and semantic assertions |
| Auth/runtime identity | Cognito → Vercel → Railway staging | Authenticated reviewer browser session; exact audit and report retrieval |
| Assembled system | Worker regression and Whole-App branch gate | Full exact-candidate closure gate |
| PDF terminal path | Chromium print output | Page count/text audit and visual inspection of every physical sheet |
