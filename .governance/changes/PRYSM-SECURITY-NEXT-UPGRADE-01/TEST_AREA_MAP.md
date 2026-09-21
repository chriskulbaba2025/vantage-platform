# Test Area Map

| Boundary | Proof | Required result |
|---|---|---|
| Dependency graph | `npm audit --audit-level=high`; production-only audit; `npm ls next postcss react react-dom` | zero advisories; patched versions, React 18 retained |
| App Router server entry | `NODE_ENV=production npm run build` | all routes typecheck and build |
| Dynamic audit routes | Next build plus authenticated staging audit/report browser flow | exact audit ID and principal context preserved |
| Session continuity | real Chromium Cognito login, refresh, dashboard return | same reviewer session remains authorized |
| Worker/report path | `npm run verify:prysm-closure` in `services/worker` | worker regression and Whole-App P-B01–P-B16 PASS |
| Terminal report/PDF | authenticated Chromium and visual PDF review | seven views, no print navigation, no clipping/blank pages |
| Exact hosted candidate | GitHub, Vercel Preview, Railway staging identities | exact candidate evidence; production untouched |
