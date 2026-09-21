# Diagnostic Evidence

## Observed outcome and exact evidence

Exact candidate `7b2514c88ebbc50a55b8426d6ad9cd3055fc530b` was authenticated in real Chromium at the authoritative PRYSM Preview and returned the exact persisted audit. Browser screenshot `20-page-priority-fixes.png` shows two accepted primary units labeled 1 and 3, while the Executive Scorecard shows those same two units as 1 and 2. Screenshot `20-page-trust-eeat.png` shows the identical “Visible proof is established in the reviewed scope…” sentence twice.

The source ownership is directly established:

- `services/worker/src/report/render-report-v2.js::blockersSection` renders only filtered `acceptedPriorityGroups`, but uses each surviving record's pre-filter `sequenceInputs.governedRank` for visible numbering. Thus rejected/hidden units leave a gap.
- `services/worker/src/report/report-detail-sections.js::trustEvidenceSection` renders `narrativeStateBlock(pageState)`, which prints `pageState.message`, and then unconditionally prints `primaryVerdict`. In the escaped real audit those strings are the same, yielding the visible duplicate.
- The existing golden fixtures used complete rank sequences and only asserted Trust wording presence, not unique visible occurrence. The proof system therefore did not cover either condition.

## Classification

Both are `VERIFIED_ROOT_CAUSE`, based on exact-candidate browser output and the executing production rendering functions above. The change is limited to visible presentation, with no change to accepted units, rank ordering, semantic state, source evidence, trust score, or report content beyond suppressing identical duplicate output.

## Harness classification

The browser harness's case-insensitive status-pattern assertion falsely classified ordinary client copy “not available” as internal enum leakage. It is separately classified as a `VERIFIED_ROOT_CAUSE` in the acceptance harness and will be corrected to test exact uppercase internal status tokens; it does not change product behavior.

## Identity/path evidence already observed

On exact Preview SHA, Cognito reviewer login returned HTTP 200. The dashboard retrieved the exact audit row, audit detail matched its ID and client, View Draft Report loaded the report, all seven navigation destinations were found, refresh retained the authenticated report session, and dashboard return succeeded. No new audit/provider action was issued. After correcting the Preview worker binding from the authoritative Railway staging secret source, the API-authorized audit retrieval succeeded.
