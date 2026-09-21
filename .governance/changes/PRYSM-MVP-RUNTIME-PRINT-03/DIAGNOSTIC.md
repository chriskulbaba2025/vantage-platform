# Diagnostic Evidence

## Exact observed result

The authenticated Playwright browser generated PDFs from Preview candidate `9dca6e2821e11ef9be7c27c60f6860a589446cc6`. The selected Content Opportunities view produced seven pages; physical page 7 contained only its final `Next step` heading and one short sentence (110 extracted characters). Visual inspection confirmed a mostly empty sheet. Other six views navigated and printed; the exact report HTML response matched the staged persisted artifact SHA `0b7ce3e9d4c479cf8f2bc70ae6840d216632a55f36a24c847625d96652425194`.

## Root cause and trial

The content-page theme uses large top margins for each direct child `h3` and generous paragraph spacing. On the long Content Opportunities section, this spacing pushed its final bounded next-step note onto a mostly empty sheet. This is a generic print-density defect at the renderer boundary; report meaning and evidence are correct.

A temporary Playwright stylesheet restricted to `@media print` and the generic `.content-page` section reduced direct heading top margins to 12px and paragraph vertical margins to 0.55em. The same authenticated Preview run then produced six pages, with the last sheet containing 1,300 extracted characters. No content was hidden, removed, or reordered. The trial stylesheet was not part of the deployed candidate; the permanent candidate will own the exact CSS and regression assertion.

## Classification

`APPLICATION_DEFECT` — exact runtime PDF evidence proves a generic renderer spacing defect. Not a report-model, audit, or harness defect. Production is untouched.
