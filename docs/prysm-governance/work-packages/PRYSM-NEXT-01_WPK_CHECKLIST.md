# Prysm PRYSM-NEXT-01 / WP-K Checklist — Calibration Harness

**Version:** 1.0.0
**Skill:** governed-coding-upgrade v2.1.0
**Branch:** feat/prysm-next-product-upgrade
**Checkpoint:** d866006.

## Requirements

- [x] WPK-01 — Ten deterministic fixture sites (strong / weak-thin / broken-path / tech-strong-weak-offer / js-heavy / partial-failure / schema-rich / no-schema / multi-service / very-small) exercised through the REAL scoring path. Proof: calibration-harness.js fixtures.
- [x] WPK-02 — Ranking expectations proven: strong > weak-thin; strong > broken-path; strong ≥ tech-strong; tech-strong > weak-thin; schema-rich ≥ no-schema; multi-service > weak-thin.
- [x] WPK-03 — State honesty proven: js-heavy → Insufficient Evidence + trust module suppressed + zero false-positive trust/schema findings; partial-failure → assessed weight exactly 90 + Complete.
- [x] WPK-04 — Convergence measurable: strong fixture 12/13 capabilities from 6 pages; js-heavy 1/1; per-fixture convergence table printed.
- [x] WPK-05 — Determinism: repeated scoring byte-identical.
- [x] WPK-06 — 19 PASS / 0 FAIL at head 948c87f (wpl-final.log); zero live calls.
- [x] WPK-07 — Live-pilot requirements recorded: .governance/changes/PRYSM-NEXT-01_CALIBRATION.md (real DFS/PageSpeed/browser runs, threshold calibration vs human judgments, cost-per-audit).
