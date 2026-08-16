# PRYSM-NEXT-01 — Evidence Requirements Matrix (WP-B)

**Status:** frozen at WP-B; extended by WP-C (capability contract) and WP-E (Playwright).

Each row: product claim → evidence capability → acquisition source → provider request/config → returned field → normalized field → artifact provenance → scoring consumer → report consumer.

## WP-B rows (DataForSEO OnPage acquisition sufficiency)

| Claim | Capability | Source | Provider request/config | Returned field | Normalized field | Artifact provenance | Scoring consumer | Report consumer |
|---|---|---|---|---|---|---|---|---|
| Page body content supports offer/trust evaluation | content.body | dataforseo-onpage | task_post `enable_content_parsing:true` + POST `/on_page/content_parsing` per key-page URL | result[0].items[] → main_content / secondary_content / sentiment_connotations | site.contentParsing[{url, wordCount, mainContentChars, hasMainContent, sentimentScore}] | `_raw.contentParsing` in raw artifact (SHA-256'd) | WP-D offer/trust/content modules (capability-gated) | Evidence appendix + trust/offer sections (v2 report) |
| Site exposes machine-readable structured data | schema.structured_data | dataforseo-onpage | task_post `validate_micromarkup:true` + POST `/on_page/microdata` {id} | items[] types/fields | site.microdataTypes[] + merged schemaTypes[] | `_raw.microdata` (+metadata) in raw artifact | WP-D schema_entity module | Schema section + evidence appendix |
| Redirect behaviour is healthy and chain depth bounded | technical.redirects | dataforseo-onpage | POST `/on_page/redirect_chains` {id, url} per key-page + 3xx pages | chain hops (url, status_code, location) | site.redirectChains[{from, to, statusCodes, hops}] | `_raw.redirectChains` | WP-D technical_hygiene (new redirect rules) | Technical section + priority fixes |
| Pages blocking indexation are known and classified | technical.indexability | dataforseo-onpage | POST `/on_page/non_indexable` {id, limit, offset} | items[] (url, reason) | site.nonIndexablePages[{url, reason}] | `_raw.nonIndexable` | WP-D technical_hygiene (indexability rules) | Technical section |
| Key pages have no broken scripts/resources | technical.resources | dataforseo-onpage | POST `/on_page/resources` {id, url, limit, offset} per key page | items[] total_resources / broken_resources | site.pageResources[{url, totalResources, brokenResources}] | `_raw.resources` | WP-D technical_hygiene (resource rules) | Technical section |

## Pre-existing rows (baseline, unchanged by WP-B)

| Claim | Capability | Source | Provider request/config | Returned field | Normalized field | Artifact provenance | Scoring consumer | Report consumer |
|---|---|---|---|---|---|---|---|---|
| Site structure/crawl health | technical.site_structure | dataforseo-onpage | task_post + `/on_page/pages` (+summary/links/duplicate_tags/duplicate_content) | pages/summary page_metrics/links | site.pages[], statusCounts, missingTitles… | `_raw.pages` etc. | existing technical/content modules | existing sections (v1) |
| Lab performance | performance.lab | pagespeed (PSI → Lighthouse CLI fallback) | PSI API / Lighthouse CLI runs per page profile | lighthouseResult categories | performance.{mobile,desktop}.scores/metrics | governed artifact store (existing) | performance module | Performance section |
| Field performance (CrUX) | performance.field | pagespeed | CrUX API | loadingExperience | performance.fieldData | governed artifact store | confidence only | Performance section (provenance) |
| Search visibility | (optional) gsc | gsc | GSC API | rows | gsc.rows | governed artifact store | GSC-gated findings only | Evidence appendix |

## WP-E rows (to be added by WP-E — reserved)

| Claim | Capability | Source | Provider request/config | Returned field | Normalized field | Artifact provenance | Scoring consumer | Report consumer |
|---|---|---|---|---|---|---|---|---|
| Primary CTA is visible/interactable on key pages | conversion.cta (validated) | playwright-conversion-path | controlled browser, key pages only, NO submit | selector state (visible, enabled, aria), navigation outcome | conversionPaths.validated[] (distinct from inferred[]) | governed artifact store (+screenshot artifacts) | WP-D conversion modules (validated tier) | Conversion path section (v2 report) |
