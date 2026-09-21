# Surgical Change Contract

- Required outcome: compact only the print spacing inside the selected Content Opportunities page enough to prevent a final one-note sheet while retaining all content and comfortable print readability.
- Owning boundary: final `@media print` rules in `services/worker/src/report/render-report-v2.js`.
- Change hypothesis: targeted print rules for `.content-page > h3` and `.content-page > p` match the proven browser trial; they change print spacing only and preserve screen layout/content.
- Expected surface: two generic CSS selectors, two renderer print-contract assertions, and this governed record.
- Protected: report model, narrative, evidence, priority membership/order, text, links, scores, identity, auth, persistence, all other report pages, and production systems.
- Direct proof: targeted renderer suite, complete exact-candidate closure gate, and authenticated exact-candidate PDFs with per-sheet text and visual review.
- Retry policy: after three failed repairs on this same root cause, reset diagnosis before further edits. The successful temporary stylesheet trial was diagnostic, not a repair.
