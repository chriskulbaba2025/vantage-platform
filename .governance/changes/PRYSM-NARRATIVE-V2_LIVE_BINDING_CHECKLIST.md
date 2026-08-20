# PRYSM Narrative v2 — Live Binding Gate

Change ID: `PRYSM-NARRATIVE-V2-LIVE-01`
Version: `1.0.0`
Release intent: `CHANGE_ONLY`
Production activation: **disabled by default**
Base exact main SHA: `f86fd42e1575712d38e8d97d5c39fc2a85307c2d`

## Objective

Bind the already-governed Narrative v2 Writer/Judge executor seams to a bounded, model-agnostic live HTTP client without changing evidence collection, scoring, Writer/Judge contracts, renderer logic, provider adapters, or the legacy report path.

This gate does not deploy, merge, configure production secrets, run a production audit, or make a live LLM/provider call.

## Mandatory cost-contract alignment

The repository's mandatory `Prysm n8n and LLM Cost Contract v1.0.0` remains authoritative.

Live Narrative v2 therefore enforces:

- explicit `PRYSM_NARRATIVE_V2_ENABLED=true`;
- explicit `PRYSM_LLM_MODE=live`;
- maximum total paid calls per audit: **2**;
- exactly Writer Pass 1 followed by Judge Pass 1;
- Judge execution requires the persisted Writer result ledger to have `validationResult: PASS`;
- no Writer Pass 2, third paid call, network retry, automatic repair call, model escalation, or hidden fallback;
- deterministic token/cost preflight before reservation;
- configured input/output token ceilings;
- configured audit hard budget;
- configured daily hard budget plus starting daily-spend value;
- same-runtime duplicate paid attempts are blocked by an in-flight reservation lock acquired before the first asynchronous artifact read;
- an immutable paid-call reservation is written before network execution;
- each durable reservation has a unique claim ID, distinguishing a conflicting claim from an idempotent same-byte write;
- immutable usage/result record after every returned provider response, including returned failures;
- provider token usage is mandatory for a returned successful response; missing/invalid usage fails closed and is never represented as `$0` actual cost;
- returned Writer/Judge model metadata must equal the configured model IDs;
- any existing durable reservation blocks silent sequential/restart re-execution after interruption.

The deterministic three-pass Narrative v2 controller remains unchanged. The live binding is intentionally narrower because the repository cost contract permits only two paid calls. If the first Judge returns `REVISE`, any attempted Pass 2 Writer call is refused before network execution and the narrative fails closed rather than exceeding the two-call ceiling.

## Model selection

No model name is hardcoded.

Production configuration supplies:

- Writer model ID;
- Judge model ID;
- exact HTTPS chat-completions endpoint;
- price table keyed by model ID;
- token ceilings and budgets.

The response metadata is bound back to those configured model IDs so the audit ledger cannot claim a different Writer or Judge model than the configured paid call.

This preserves the policy that Prysm should use the least expensive structured-output-capable model that passes the benchmark.

## Provider boundary

The binding uses Node's existing `fetch` capability and an OpenAI-compatible chat-completions HTTP contract. No new model SDK dependency is introduced.

The API key is read from configuration only, sent only in the Authorization header, and is never placed in WriterInput, Judge input, report output, ledger artifacts, or errors.

## Payload rules

Writer receives only the existing governed Writer prompt built from WriterInput.

Judge receives only:

- fixed Judge instructions;
- pass number;
- frozen Judge runtime contract;
- exact governed WriterInput;
- exact validated WriterOutput.

No raw provider responses, report HTML/CSS, screenshots, debug logs, credentials, or conversation history are sent.

## Validation

Returned message content must be a JSON object. No markdown/code-fence repair is attempted.

- Writer result is validated with `validateWriterOutput` before return.
- Judge result is validated with `validateJudgeResponse` before return.
- Writer `modelId` must equal the configured Writer model ID.
- Judge `judgeModelId` must equal the configured Judge model ID.
- A returned successful provider response must contain valid integer token usage sufficient to calculate governed actual cost.
- The Narrative v2 orchestrator validates Writer and Judge output again at its canonical boundary.

Invalid output or invalid/missing provider usage fails closed.

## Spend/restart/concurrency safety

Before every paid request, the binding acquires an in-process reservation lock keyed to the audit/role/pass **before its first asynchronous artifact read**. A concurrent duplicate request in the same runtime is rejected before reservation or network execution.

The winning same-runtime attempt writes an immutable reservation under:

`report-v2/narrative-v2/live-usage/call-XX-reservation.json`

Each reservation includes a unique claim ID. This keeps conflicting durable claims distinguishable from an idempotent same-byte write, while the persisted reservation protects sequential retries and process restarts from silently repeating an uncertain paid attempt.

After every returned provider response the binding writes:

`report-v2/narrative-v2/live-usage/call-XX-result.json`

A successful validated response records provider-reported token usage and calculated actual cost. A returned HTTP/error/content/usage failure records a fail-closed result with `actualCost: null`; it is never misrepresented as zero spend.

If a reservation already exists for the same audit call sequence, the binding refuses to make that paid request again.

### Cross-process limitation

The current governed production object store enforces immutability through existence/read/write verification, but its interface does **not** expose an atomic conditional-create or transactional compare-and-set primitive. Therefore this PR does not claim or authorize simultaneous live execution of the same audit across multiple worker processes/replicas.

The next controlled live audit must run with **one worker process/replica**. Before unattended or multi-worker live rollout, Prysm requires a durable cross-process execution claim/lock (or atomic conditional reservation) in addition to the existing durable reservation artifacts.

## Live sequence

The paid sequence is structurally fixed:

1. Call 1 = Writer Pass 1.
2. Writer response must validate and produce a persisted PASS result ledger.
3. Call 2 = Judge Pass 1.
4. No third paid call is permitted.

A Judge call made before a validated Writer result is rejected before network execution.

## Legacy-path isolation

When the automatic Narrative v2 live binding is enabled from environment and no legacy narrative client is injected, the legacy WP9 narrative mode remains `mock` even though `PRYSM_LLM_MODE=live` is required for the v2 binding. This prevents the v2 switch from accidentally activating an unconfigured legacy model path.

Injected legacy narrative dependencies retain their existing behavior.

## Daily budget limitation for controlled activation

The binding enforces `PRYSM_LLM_DAILY_HARD_BUDGET_USD` against:

- `PRYSM_LLM_DAILY_SPEND_USD` supplied at process start; and
- reservations made by the current process thereafter.

The repository does not currently expose a durable cross-audit aggregate cost index through the governed ArtifactStore interface. Therefore this gate is sufficient for the next **single controlled live acceptance/production audit on one worker process/replica**, but it does not authorize unattended multi-audit or multi-worker live rollout.

Before broad live automation, add both:

1. durable cross-process execution claiming/atomic reservation; and
2. a durable cross-process daily aggregate cost index, or an externally supplied equivalent.

## Deterministic proof

`live-binding.test.js` proves:

1. disabled by default;
2. enabled mode requires explicit live mode;
3. one Writer + one Judge call are validated, usage/cost ledgered, and capped at two;
4. a third paid call is blocked;
5. a reserved failed provider attempt cannot be silently retried and its returned failure is durably recorded;
6. input-token ceiling rejects before reservation/network execution;
7. price table and hard budgets are mandatory;
8. Judge cannot execute before a validated Writer result;
9. missing provider token usage fails closed and is not recorded as zero actual cost;
10. same-runtime concurrent duplicate Writer attempts result in only one paid network call;
11. returned Writer model metadata must match the configured Writer model ID.

All tests inject fake `fetch`. Live provider/LLM calls in CI: **0**.

## Frozen scope

Authorized files:

- `services/worker/src/narrative-v2/live-binding.js`
- `services/worker/src/narrative-v2/live-binding.test.js`
- `services/worker/src/application/production-runtime.js`
- `services/worker/.env.example`
- `.governance/changes/PRYSM-NARRATIVE-V2_LIVE_BINDING_CHECKLIST.md`

No provider adapters, evidence contracts, scoring logic, Writer/Judge contracts, renderers, server routes, deployment configuration, or production secrets are changed.
