# Closure Checklist

- [x] Exact starting branch/SHA and clean tree recorded.
- [x] Exact pre-fix PDF and screenshots preserved.
- [x] Both root causes reproduced with print-only Chromium overrides.
- [x] Smallest renderer boundary and protected surfaces frozen.
- [x] Targeted renderer contract test passes (32/32 render-report-v2 tests), including active-view pagination and print-footer rules.
- [x] CR-43 27-case matrix comparisons have zero unexplained output changes beyond the governed print CSS rules.
- [ ] Full worker/application/Whole-App closure gate must pass on the final pushed candidate.
- [ ] Exact final SHA is pushed and staged on authoritative Vercel and Railway.
- [ ] Authenticated browser identity path and seven-page navigation pass.
- [ ] Fresh final PDF has no materially blank page, orphan heading, clipping, or missing content.
- [ ] Independent post-run audit has zero open CRITICAL/MAJOR and all MINOR findings disposed.
- [ ] GitHub durable project state and numbered closure proofs are refreshed.
