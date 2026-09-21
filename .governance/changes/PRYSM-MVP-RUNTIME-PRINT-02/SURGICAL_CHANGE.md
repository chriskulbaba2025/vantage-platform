# Surgical Change Contract

- Required outcome: allow only the selected active report view to fragment naturally across printed sheets while retaining keep-together behavior for its smaller cards and rows.
- Owning boundary: final print rules in `render-report-v2.js`.
- Change hypothesis: a higher-specificity print rule for `body.viewer-ready main > section.viewer-active` set to `break-inside:auto` and `page-break-inside:auto` prevents the selected long view from being treated as one keep-together card.
- Expected surface: that CSS rule, one renderer print-contract assertion, and this governed package.
- Protected: report model, semantic content, scores, priorities, data, APIs, persistence, auth/tenant identity, other audits, and production configuration.
- Direct proof: exact browser-generated PDFs for all seven views; no title-only, footer-only, clipped, or materially blank pages; final page and text review.
- Reset rule: stop after three failed repairs on the same print root cause and re-diagnose. No repair attempt has yet been made; the injected CSS run was diagnostic.
