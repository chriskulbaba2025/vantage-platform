# Test Area Map

| Area | Boundary | Required proof |
|---|---|---|
| Print CSS | `render-report-v2.js` final print rules | Content-page heading and paragraph density asserted as print contract |
| Renderer | `render-report-v2.test.js` | Targeted suite passes |
| Runtime/browser | Cognito → Vercel Preview → Railway staging | Exact candidate identity and authenticated seven-view flow |
| PDF | Chromium PDF for all selected views | No sparse sheet, clipping, overflow, missing content, or print navigation; inspect all pages |
| Assembled system | worker regression + app closure + Whole-App | Full exact-candidate closure gate passes |
| Independent challenge | final postrun protocol | Fresh-context audit, zero critical/major; dispose minors |
