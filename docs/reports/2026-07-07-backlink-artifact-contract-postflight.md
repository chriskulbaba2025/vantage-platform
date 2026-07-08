# Postflight Report — Backlink Artifact Manifest Contract

**Date:** 2026-07-07
**Task:** Add stable local artifact manifest contract for downstream consumers

## Summary

Added a fourth artifact (`backlink-manifest.json`) with a stable contract that AWS storage, Railway worker hosting, and n8n orchestration can consume without changing the adapter contract. Also added schema/contract validators for all four artifact outputs, exported for testing and downstream use.

## Objective

- Add `backlink-manifest.json` beside the existing three local outputs
- Manifest includes: artifactVersion, generatedAt, mode, target, includeSubdomains, hasCompetitors, competitors, worth_pursuing, summaryMetrics, files, source, limitations
- Add schema/contract validation for all four artifacts
- Update runner console output to include Mode, Target, Artifact directory, and all 4 artifact paths
- All tests pass without credentials
- No secrets in any artifact

## Files Changed

| File | Change |
|------|--------|
| `services/worker/src/adapters/dataforseo-backlinks/backlink-artifact-writer.js` | Added `buildManifest`, `validateRequiredFields`, `validateRawArtifact`, `validateNormalizedArtifact`, `validateSummaryArtifact`, `validateManifestArtifact` (all exported). Updated `writeArtifacts` to write manifest and accept `fetchError` for credential-blocker detection. Handles both `backlinks_spam_score` (live) and `spam_score` (fixture) field names. |
| `services/worker/src/runners/run-backlink-test.js` | Updated console output with Mode, Target, Artifact directory, Manifest path, worth_pursuing. Added `dirname` import. Passes `fetchError` to `writeArtifacts`. |
| `services/worker/src/adapters/dataforseo-backlinks/backlink-adapter.test.js` | Added 17 new tests covering: all 4 artifacts exist, paths under correct directory, manifest structure, manifest values, credential safety across all 4 files, and schema validators (pass + fail paths). |

## Commands Run

- `npm run test:backlinks` — 72/72 tests passed (55 previous + 17 new)
- Fixture runner verification — all 4 artifacts written, console output correct

## Validation Results

| Validator | Result |
|-----------|--------|
| Test suite (72 tests, 8 suites) | PASS |
| All 4 artifacts written | PASS |
| Artifact paths under artifacts/local/backlink-tests/ | PASS |
| Manifest target matches requested target | PASS |
| Manifest mode equals fixture | PASS |
| Manifest worth_pursuing = 0 without competitors | PASS |
| Manifest summaryMetrics all present | PASS |
| Manifest source.provider = dataforseo | PASS |
| Manifest source.endpoints is array | PASS |
| No credentials in any artifact (4 files) | PASS |
| validateRawArtifact passes | PASS |
| validateNormalizedArtifact passes | PASS |
| validateSummaryArtifact passes | PASS |
| validateManifestArtifact passes | PASS |
| Validators fail clearly on missing fields | PASS |
| Runner console shows Mode/Target/Artifact directory/4 paths | PASS |
| No live API credentials required | PASS |

## Known Blocker

Live DataForSEO verification remains blocked by external credential authorization failure. This does not affect the artifact contract — the manifest and validators work identically in fixture and live modes.

## Next Recommended Task

Set `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` and run:
```
node services/worker/src/runners/run-backlink-test.js --target solescience.ca
```
to confirm the manifest writes correctly with live DataForSEO summary metrics.
