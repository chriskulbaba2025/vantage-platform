# Diagnostic Evidence

## Exact observed failure

Authenticated Chromium generated one PDF for each of the seven selected views from candidate `062ce2b302c0b81d1e3eb7dce2461c50237726a2`. The combined 51-page PDF had a competitor heading-only sheet (physical page 24), a supporting-detail title-only sheet (page 30), and a footer-only terminal sheet (page 51). The competitor section used six physical sheets although five suffice. The exact pre-fix PDF and screenshots are preserved under `Downloads/PRYSM-MVP-CLOSURE-2026-09-21/prechange-062ce2b-print/`.

## Executing cause

`services/worker/src/report/render-report-v2.js` applies `break-inside:avoid` to `.card:not(.primary-page-card)` and other card-like blocks in print media. A selected long view such as `#competitors` (3,791 CSS px) has `.card.viewer-section.viewer-active`, so it inherits the keep-together rule. Supporting Detail is also long and receives the generic `main > section:not(.card)` rule. Chromium then separates view headings from content and emits trailing footer-only pages.

An exact-runtime diagnostic injected only `body.viewer-ready main > section.viewer-active { break-inside:auto !important; page-break-inside:auto !important; }`. The competitor PDF dropped from six pages to five; all five sheets carried report content (1,119–1,531 extracted characters), with no heading-only or footer-only sheet. This isolates the CSS keep-together rule as the cause.

The permanent 27-case CR-43 renderer matrix changed only by this CSS rule after normalizing whitespace. A reviewed comparison found zero unexplained HTML/content or semantic differences.

The final PDF still had a footer-only physical page (page 46). Source places the footer after the selected report layout, outside the active view. An exact authenticated Chromium diagnostic that hid only `body.viewer-ready > footer` reduced Supporting Detail from 18 sheets to 17; every remaining page carried report content (minimum 547 extracted characters), and all assessment sections remained present. Footer version metadata is already in the visible report header; the on-screen footer remains unchanged.

## Classification

`VERIFIED_ROOT_CAUSE`. This is an application print-layout defect, not a report-content or browser-harness defect. The staging identity path is the real Cognito reviewer flow and the exact Vercel → Railway staging report route; the print overrides were diagnostic only.
