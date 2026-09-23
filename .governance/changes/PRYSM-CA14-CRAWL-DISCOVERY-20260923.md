# PRYSM CA14 crawl discovery closure

Status: generalized candidate PASS; staging authorization not requested or inferred.

Target: `https://ca14.biz/`

Historical audit identities recovered:

- `f54de672-45ec-49db-91e5-f5160523fb2f` — CA14 Marketing, apex target.
- `c2fffe7c-cce3-4820-9e3b-57aee913027a` — www target.

Historical artifact truth: neither recovered provider run was literally one page. Both provider runs returned zero pages with `forbidden_http_header`. The www run additionally lost its valid apex sitemap footprint because literal-origin filtering treated `www.ca14.biz` and `ca14.biz` as unrelated. The apex run recovered 98 sitemap URLs before the provider failure.

Root cause: `services/worker/src/evidence/sitemap-footprint.js` compared exact URL origins instead of bounded same-site host identity.

Repair: normalize HTTP(S) hostnames by removing a leading `www.` for sitemap/redirect/page admission while preserving external-domain rejection and caps. Added a deterministic regression test.

Source candidate SHA: `2d0b674241201b88f9031bbdaefee1ae673c1432`.

Proof: CA14 proof directory contains the recovered PostgreSQL/S3 identity, artifact hashes, page-count trace, replay, targeted tests, adversarial proof, full regression, and exact-head audit.

Tests: focused 90 passed / 0 failed; full worker 1053 passed / 0 failed.

Production: untouched. Paid calls: none. Staging: not deployed; authorization was not inferred.

Exact next action: obtain explicit isolated staging authorization before any hosted deployment or hosted exact-SHA validation.
