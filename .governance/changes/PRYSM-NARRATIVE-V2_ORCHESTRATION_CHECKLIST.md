# PRYSM Narrative v2 — Three-Pass Orchestration Checklist

Change ID: `PRYSM-NARRATIVE-V2-ORCHESTRATION`
Version: `1.0.0`
Release intent: `CHANGE_ONLY`
Starting SHA: `0349a357ca773b67bfd1ce6b27016f89f986c7eb`
Stack parent: `fix/prysm-writer-v2-output` / PR #63
Production activation: **not authorized by this change**

## Objective

Connect the already-governed Writer v2 and Judge v2 contracts with one deterministic controller:

`Writer -> Writer validation -> Judge -> Judge validation -> targeted Writer revision -> final deterministic gate`

The controller must allow at most three narrative passes, must never let the Judge inspect an unvalidated Writer output, must never start a revision without a validated `REVISE` decision, and must route an unsuccessful Pass 3 to `HUMAN_REVIEW_REQUIRED` with no automatic Pass 4.

## Release boundary

This change is contract/orchestration proof only. It does **not** wire the controller into the active audit lifecycle, production model client, renderer, persistence, approval, deployment, or provider path.

## Permitted files

- `.governance/changes/PRYSM-NARRATIVE-V2_ORCHESTRATION_CHECKLIST.md`
- `services/worker/src/narrative-v2/orchestrator.js`
- `services/worker/src/narrative-v2/orchestrator.test.js`
- `services/worker/package.json` — additive test script only
- `.github/workflows/worker-ci.yml` — additive narrative-v2 test step only

## Prohibited files / behavior

- `services/worker/src/narrative/narrative-service.js`
- `services/worker/src/orchestration/audit-orchestrator.js`
- lifecycle/state-machine code
- renderer/report output code
- scoring/finding generation
- provider adapters or source-normalization code
- storage/database/migrations
- deployment/runtime configuration
- live provider or LLM execution

## Producer -> Contract -> Consumer map

| Producer | Produced object | Contract / validation | Consumer | Failure result |
|---|---|---|---|---|
| governed upstream | `WriterInput` | existing WriterInput contract | Writer prompt/executor | controller rejects missing/invalid orchestration inputs |
| Writer executor | candidate `WriterOutput` | `validateWriterOutput()` for the exact pass | Judge executor | stop immediately; Judge call count remains zero for that pass |
| Judge executor | candidate Judge response | `validateJudgeResponse()` for the exact pass | deterministic next-action gate | stop immediately; no later Writer pass |
| validated Judge `REVISE` | exact `revisionDirective` + defects | existing Judge contract + `buildWriterPrompt()` | next Writer pass | no revision when decision/directive is not governed |
| revised Writer executor | candidate next-pass `WriterOutput` | `validateWriterOutput()` + `validateTargetedWriterRevision()` through the existing Writer validator | next Judge pass | collateral rewrite fails before Judge |
| validated Judge `PASS` | deterministic release decision | `nextActionForJudge()` | orchestration result | `RELEASE_CANDIDATE` only |
| validated Pass 3 failure | deterministic human-review decision | existing Judge max-pass rule | orchestration result | `HUMAN_REVIEW_REQUIRED`; no Pass 4 |

## Acceptance freeze

Entry boundary:
- exact governed `WriterInput` object;
- injected `writerExecutor` and `judgeExecutor` functions;
- no ambient/global model client.

Execution boundary:
- Pass 1 Writer prompt is built by the existing fixed Writer prompt builder;
- Pass 2/3 prompts receive only the immediately previous validated WriterOutput and validated Judge response;
- Writer output is validated before any Judge call;
- validated Writer output is retained/frozen and the same object is consumed by the Judge;
- Judge response is validated before any next action is derived;
- only a validated `REVISE` can authorize the next Writer pass;
- targeted revisions are checked against the exact prior validated output and exact Judge revision directive;
- a validated `PASS` returns `RELEASE_CANDIDATE`;
- a validated unsuccessful Pass 3 returns `HUMAN_REVIEW_REQUIRED`;
- no fourth Writer or Judge call is possible.

Failure boundary:
- Writer execution failure -> fail closed; no Judge call for that pass;
- Writer validation failure -> fail closed; no Judge call for that pass;
- Judge execution/validation failure -> fail closed; no later Writer pass;
- no renderer, persistence, lifecycle transition, provider call, or deployment action occurs in this controller.

External-call ceiling for automated proof: `0` live provider/model calls.

## Frozen checklist

- [ ] `ORCH-01` — Pass 1 builds the governed Writer prompt and sends WriterInput to the injected Writer executor.
- [ ] `ORCH-02` — Judge receives only a WriterOutput that already passed `validateWriterOutput()` for the exact pass.
- [ ] `ORCH-03` — invalid Writer output terminates before the Judge executor is called.
- [ ] `ORCH-04` — invalid Judge output terminates before another Writer pass can begin.
- [ ] `ORCH-05` — a validated `PASS` terminates immediately as `RELEASE_CANDIDATE`.
- [ ] `ORCH-06` — a validated `REVISE` is the only automatic path to Pass 2 or Pass 3.
- [ ] `ORCH-07` — Pass 2/3 use the exact immediately previous validated WriterOutput and exact validated Judge revision directive.
- [ ] `ORCH-08` — collateral rewriting outside `fieldsToRewrite` fails Writer validation before the next Judge call.
- [ ] `ORCH-09` — unsuccessful Pass 3 terminates as `HUMAN_REVIEW_REQUIRED` with exactly three Writer and three Judge calls and no Pass 4.
- [ ] `ORCH-10` — all narrative-v2 contract/orchestration tests run in exact-head CI with zero live provider/model calls.

## Protected invariants

- DataForSEO source/provenance terminology remains unchanged.
- No downstream alias or guessed field name is introduced.
- Missing/unavailable evidence is not converted into false/zero/absent evidence.
- Writer remains limited to `INTERPRETATION` and `OPPORTUNITY`.
- Every substantive Writer atom remains evidence-referenced through `WriterInput.referenceIndex`.
- Judge rubric/release thresholds remain unchanged: >=92 total, evidence fidelity 20/20, every dimension >=70%, zero hard-gate violations, no `MAJOR` defect.
- Maximum narrative passes remains exactly three.
- No production merge, deployment, activation, or paid call is authorized.

## Verification contract

Narrow:

```text
cd services/worker
node --test src/narrative-v2/orchestrator.test.js
```

Affected contract suite:

```text
cd services/worker
npm run test:narrative-v2
```

Exact-head proof:
- GitHub Actions `worker-ci` must execute `npm run test:narrative-v2` on the exact PR head.
- A green workflow that does not execute this command does not prove this change.

## False-PASS rejection

The acceptance tests must use the real production contract functions (`buildWriterPrompt`, `validateWriterOutput`, `validateJudgeResponse`, `nextActionForJudge`) and an injected controlled executor below the orchestration boundary. Tests must measure Writer/Judge call counts and prove prohibited later calls remain zero on failure. No test may pre-seed a terminal orchestration state or bypass Writer/Judge validation.