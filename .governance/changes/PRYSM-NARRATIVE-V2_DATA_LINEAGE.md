# PRYSM Narrative v2 — Canonical Data Lineage Gate

Status: FROZEN DESIGN INPUT
Base production SHA: `ea5e0a26b39a395874addc1ef3488d50bb16f5d3`
Branch: `fix/prysm-narrative-lineage-v2`

## Purpose

Prevent report data loss caused by approximate, aliased, renamed, or guessed field names between provider acquisition, governed evidence, scoring, LLM interpretation, and rendering.

## Governing rule

Every report-eligible data point must have one auditable lineage:

`source-native field -> one explicit normalization -> canonical governed field -> deterministic finding/score -> Writer evidence reference -> Judge evidence reference -> rendered report section`

No consumer after the normalization boundary may guess an alternate name.

## DataForSEO rule

DataForSEO source-native field names are preserved exactly in lineage metadata. The DataForSEO adapter is the only permitted boundary at which a source-native DataForSEO field may be mapped into a PRYSM canonical field.

PRYSM does **not** globally rename its canonical domain model to provider-specific names. Doing that would couple scoring, governance, and rendering to one provider. Instead:

1. DataForSEO payload terminology is exact and authoritative at acquisition/provenance.
2. A single explicit, tested mapping converts each permitted DataForSEO source path to one canonical PRYSM path.
3. All downstream consumers use that exact canonical path only.
4. The source-native DataForSEO path remains attached to the lineage record so the value can always be traced back to the provider payload.
5. Legacy aliases and fallback names are prohibited outside the adapter normalization boundary.

## Non-DataForSEO sources

PageSpeed, GA4, GSC, browser conversion validation, and any future source retain their own exact source-native terminology in lineage metadata and map once into their own governed canonical namespace.

## Required lineage tuple

Every Writer/Judge evidence reference must resolve to a registered lineage tuple containing:

- `source`
- `provider`
- `sourceField`
- `canonicalField`
- `transformation`

`transformation` must be `identity`, `derived`, or `bounded-normalization` and must describe any non-identity conversion.

## Hard failures

Narrative v2 must fail closed when any of the following occurs:

- a source field is referenced that is not registered;
- a canonical field is referenced that is not registered;
- an alias is used in place of a canonical field;
- a Writer/Judge evidence reference cannot resolve to a registered lineage tuple;
- a source-native field is silently renamed after normalization;
- a missing/unknown value is silently converted to `0`, `false`, an empty array, or an empty string when that changes meaning;
- business intake context is dropped or reconstructed instead of copied from the persisted governed request;
- a report section says evidence is absent when the canonical artifact contains an available value.

## Business context lineage

The following values must be copied exactly from the persisted governed audit request into Writer v2 input:

- `businessName`
- `targetUrl`
- `primaryGoal`
- `market`
- `language`
- `services`
- `competitors`

They must never be reconstructed by the renderer or replaced by defaults when a persisted value exists.

## Report regression requirement

Historical Karen Leslie-style reports and prior Reboot production reports are regression references. For every material item expected in the new report, the build audit must answer:

1. Did the persisted audit contain the data?
2. What exact source-native field supplied it?
3. What exact canonical field stored it?
4. Did the previous report render it?
5. Does Writer v2 receive it?
6. Does Judge v2 retain its evidence lineage?
7. Does the new report render it or intentionally explain why it is not assessed?

If the persisted evidence contains the value and the downstream narrative/report silently loses it, the build fails.

## Production boundary

This work package is additive and must not change production acquisition, scoring, or report output until the lineage registry and regression tests pass. No merge/deploy is authorized by this document.