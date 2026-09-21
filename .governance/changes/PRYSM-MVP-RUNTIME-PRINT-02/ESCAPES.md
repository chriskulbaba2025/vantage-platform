# Verification Escape

- Class: `INTEGRATION_ESCAPE` and `FALSE_PASS_ESCAPE`.
- Escaped behavior: the previous browser acceptance generated selected-view PDFs but did not assert physical page content density or visually inspect every sheet; long active report cards could strand headings and append footer-only sheets while UI navigation still passed.
- Permanent correction: renderer-level regression requires the active selected view to fragment in print; exact-candidate acceptance now inspects every physical page and records page text lengths and visual review.
- Preserved evidence: `Downloads/PRYSM-MVP-CLOSURE-2026-09-21/prechange-062ce2b-print/21-candidate-before-print-fix.pdf` and screenshots.
