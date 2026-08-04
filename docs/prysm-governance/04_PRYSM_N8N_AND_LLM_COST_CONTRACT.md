# Prysm n8n and LLM Cost Contract

**Version:** 1.0.0  
**Status:** Mandatory cost and autonomy gate

---

# 1. Objective

Use LLMs only where they improve client-facing language.

Do not use LLMs for work that code can perform deterministically.

The normal rebuild and test process should have zero live model spend.

---

# 2. Allowed LLM responsibilities

The LLM may:

- create concise executive interpretation from approved facts;
- reduce repetition;
- improve client-facing clarity;
- group approved findings within fixed report fields;
- create wording that follows fixed length and language rules.

The LLM may not:

- collect evidence;
- classify source status;
- calculate scores;
- create finding IDs;
- invent findings;
- add recommendations;
- select report sections;
- create HTML or CSS;
- control pagination;
- approve a report.

---

# 3. Production n8n workflow

```text
Receive ReportContentPackage
→ validate input schema
→ check narrative cache
→ calculate token and cost ceiling
→ call approved primary model
→ validate JSON response
→ optional single repair call
→ store narrative and usage record
→ return NarrativeResponse
```

Prohibited:

- loops;
- autonomous agents;
- sub-agents;
- recursive workflows;
- model debates;
- repeated scoring;
- open-ended retries;
- automatic escalation to a more expensive model.

---

# 4. Execution modes

## Mock

```text
PRYSM_LLM_MODE=mock
```

Used for unit tests, CI, renderer tests and most development.

Live model cost: zero.

## Replay

```text
PRYSM_LLM_MODE=replay
```

Uses a stored approved response keyed by the canonical request hash.

Used for end-to-end development, visual regression and repeated staging tests.

Live model cost: zero after capture.

## Live

```text
PRYSM_LLM_MODE=live
```

Used only for model benchmarks, final staging acceptance and approved production audits.

Live mode must be explicit and must never be a fallback.

---

# 5. Model selection policy

Do not hardcode the architecture to a marketing model name.

The approved primary model is:

> The least expensive structured-output-capable model available in the connected account that passes the Prysm narrative benchmark.

Benchmark dimensions:

- factual fidelity;
- finding-ID fidelity;
- no invented claims;
- field completeness;
- word-limit compliance;
- reading level;
- JSON validity;
- report quality;
- cost per report;
- latency.

A more expensive model is allowed only when the cheaper model fails the benchmark and the quality or safety difference is documented.

---

# 6. Call limits

Default:

- primary calls per audit: 1;
- repair calls per audit: 0 or 1;
- maximum total calls: 2;
- automatic model escalation: disabled;
- network retry: 1;
- invalid-JSON repair: uses the single repair allowance;
- reasoning level: lowest setting that passes the benchmark.

The workflow fails safely after the cap.

---

# 7. Token and budget controls

Each live node declares:

- model ID;
- maximum input tokens;
- maximum output tokens;
- maximum retries;
- maximum calls per audit;
- prompt version;
- output schema version.

Before a call:

1. build the compact payload;
2. count or estimate tokens;
3. reject payloads above the ceiling;
4. calculate maximum possible cost from a configurable price table;
5. reject calls above the audit budget;
6. record the decision.

Use configurable controls:

```text
PRYSM_LLM_SOFT_BUDGET_USD
PRYSM_LLM_HARD_BUDGET_USD
PRYSM_LLM_DAILY_HARD_BUDGET_USD
```

When a hard budget is reached, live mode stops. Mock and replay remain available.

---

# 8. Cache policy

Cache key:

```text
SHA256(
  reportContentPackage
  + promptVersion
  + modelId
  + outputSchemaVersion
)
```

An exact cache hit returns the stored narrative. No model call is made.

---

# 9. Compact payload policy

Do not send:

- raw provider responses;
- full canonical evidence;
- report HTML;
- CSS;
- screenshots;
- duplicated source records;
- debug logs;
- code;
- conversation history;
- credentials.

Send only:

- stable field names;
- short fixed instructions;
- finding IDs;
- concise facts;
- output schema;
- per-field limits.

---

# 10. Cost ledger

Every attempt records:

- audit ID;
- execution ID;
- workflow version;
- node ID;
- mode;
- model ID;
- prompt version;
- input tokens;
- output tokens;
- cached input tokens;
- estimated cost;
- actual cost;
- retry number;
- cache hit;
- validation result;
- timestamp.

Provide summaries by audit, client, workflow version, model, day and month.

---

# 11. Validation and repair

Validate:

- JSON schema;
- required fields;
- known finding IDs;
- no extra findings;
- no new URLs;
- score values unchanged;
- word limits;
- prohibited phrases;
- HTML/CSS absence;
- field completeness.

A repair call receives the invalid response, validation errors and original compact facts.

After one failed repair, mark `NARRATIVE_FAILED`.

---

# 12. Testing policy

Normal test suite:

- mock only;
- no OpenAI request;
- no provider request;
- deterministic output.

Narrative benchmark:

- use fixed representative report fixtures;
- run manually or through a dedicated benchmark command;
- record quality and cost;
- select the cheapest passing model.

Release acceptance:

- use one controlled live call;
- store the approved response;
- use replay afterward.

---

# 13. n8n governance

Every production workflow export is versioned and includes:

- workflow version;
- prompt version;
- model configuration;
- input schema version;
- output schema version;
- maximum calls;
- maximum tokens;
- test fixture;
- benchmark result;
- rollback workflow ID.

Credentials are referenced, not embedded.

---

# 14. Stop conditions

Stop when:

- the audit budget would be exceeded;
- the daily budget is reached;
- input tokens exceed the ceiling;
- required fields are missing;
- the model invents IDs or URLs;
- the response contains HTML or CSS;
- the repair attempt fails;
- the report-content hash changes during execution.
