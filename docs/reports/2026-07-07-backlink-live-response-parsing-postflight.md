# Postflight Report — Live DataForSEO Response Parsing Fix

**Date:** 2026-07-07
**Task:** Fix live DataForSEO response parsing and process.exit Windows assertion

## Summary

Fixed two bugs preventing the backlink adapter from running in live mode:
1. The DataForSEO client did not handle the live API response structure correctly — the raw response text wasn't being parsed properly, and status_code validation was missing
2. `process.exit(1)` calls in the runner triggered a Windows-specific `UV_HANDLE_CLOSING` assertion

## Objective

- Parse live DataForSEO API responses correctly (handle double-encoding, validate status codes)
- Avoid `process.exit()` in the runner to prevent Windows libuv assertion
- Add tests covering all parsing edge cases

## Files Changed

| File | Change |
|------|--------|
| `services/worker/src/adapters/dataforseo-backlinks/dataforseo-backlinks-client.js` | Added `parseDataforseoResponse`, `extractTaskResult`, `extractAllTaskResults` (all exported). Updated `dataforseoPost` to read response as text with safe parsing. Updated all three fetch methods to use extraction helpers. |
| `services/worker/src/runners/run-backlink-test.js` | Replaced all `process.exit(1)` with `process.exitCode = 1; return;` |
| `services/worker/src/adapters/dataforseo-backlinks/backlink-adapter.test.js` | Added 14 new tests in "DataForSEO Response Parsing" suite |

## New Response Parsing Design

```
dataforseoPost
  → response.text()
  → parseDataforseoResponse(rawText, endpoint)
    → JSON.parse (handles strings)
    → JSON.parse again (handles double-encoding)
    → validates root status_code === 20000
  → extractTaskResult / extractAllTaskResults
    → validates tasks array exists
    → validates task status_code === 20000
    → extracts result[0] from each task
```

## Commands Run

- `npm run test:backlinks` — 55/55 tests passed (41 original + 14 new)
- Fixture runner verification — clean output, exit code 0
- Error path verification — clean exit code 1, no UV_HANDLE_CLOSING

## Validation Results

| Validator | Result |
|-----------|--------|
| Test suite (55 tests, 8 suites) | PASS |
| Double-encoded JSON parsing | PASS |
| Triple-encoded JSON parsing | PASS |
| Root status_code validation | PASS |
| Task status_code validation | PASS |
| Zero-valued fields preserved | PASS |
| extractAllTaskResults skip failed | PASS |
| Missing task status_code tolerated | PASS |
| Fixture mode unchanged | PASS |
| No process.exit in runner | PASS |
| No UV_HANDLE_CLOSING assertion | PASS |
| worth_pursuing = 0 without competitors | PASS |

## Security Checks

- Secret exposure: PASS — no credentials in any diff or artifact
- The `parseDataforseoResponse` function reads from `response.text()`, never logs body

## Blockers

None. User must set `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` env vars and run the live test to confirm end-to-end.

## Next Step

Run live test with credentials:
```powershell
$env:DATAFORSEO_LOGIN = "<login>"
$env:DATAFORSEO_PASSWORD = "<password>"
node services/worker/src/runners/run-backlink-test.js --target solescience.ca
```

Expected: Mode: live, summary loaded, all 3 artifacts written, worth_pursuing = 0.
