# Surgical Change Contract

- **Required outcome:** All seven conceptual pages show client-facing narrative and capability labels; no visible internal narrative-state enums, “Bounded action” label, raw AVAILABLE/PARTIAL/UNAVAILABLE values, or contradictory duplicated evidence labels. Evidence distinctions remain accurate.
- **Hypothesis:** The generic v2 Trust section helper and capability-summary presentation map own the observed defects. Removing visible internal state tokens, changing the label to client language, rendering capability-specific names with existing semantic status mapping, and extending the regression to all seven page sections will eliminate the reproduced defects without changing source evidence or scoring.
- **Causal boundary:** `report-detail-sections.js:narrativeStateBlock`; `render-report-v2.js` client capability/status projection and presentation version; associated renderer tests.
- **Expected source/test surface:** `services/worker/src/report/report-detail-sections.js`, `services/worker/src/report/render-report-v2.js`, `services/worker/src/report/render-report-v2.test.js`, and `services/worker/src/report/render-report-v2-section-viewer.test.js`. Add this governed change package and closure proof files.
- **Protected surface:** Scoring, evidence, accepted priorities, statuses in canonical state, storage keys, lifecycle, auth/tenant policy, v1 output, provider/model paths, production configuration/data, and all non-target staging audits.
- **Structural budget:** Presentation helpers and deterministic tests only; no schema, dependency, route, database, identity, or provider changes.
- **Direct acceptance proof:** Exact canonical 51-artifact dataset rendered by the exact candidate; all seven sections and mapped capability names/statuses asserted; no visible internal states/jargon/raw statuses; source statuses remain distinct.
- **Escaped-proof regression:** Expand `MVP-CLIENT-02` from an Executive-only prefix to the complete seven-page viewer surface; assert Trust and Supporting Detail helper output.
- **Runtime proof:** Rebuild only this audit's staging report-v2 HTML from the frozen canonical dataset after the candidate is deployed; compare serving bytes/hash to the generated artifact; authenticate and inspect all seven pages and page-selected PDFs.
- **External work:** No paid calls, new audit, Writer, or Judge. Vercel Preview and the existing authoritative GENSEN staging target only.
- **Scope expansion:** Any required model, route, contract, storage, or production change reopens this contract before implementation.
