# Prysm Rebuild Acceleration Standard

**Version:** 1.0.0  
**Effective date:** 2026-08-06  
**Status:** Governing source rule  
**Applies to:** Every Prysm rebuild work package, correction, review, acceptance gate, and release decision from WP5 closure onward

---

## 1. Purpose

This standard governs how every remaining Prysm improvement is planned, prompted, built, tested, audited, corrected, and closed.

Its purpose is to reduce avoidable rework and achieve a **minimum target of 55% lower active cycle time** than the prior prompt–build–audit–correction method.

The speed target must never weaken:

- report immutability;
- evidence integrity;
- lifecycle correctness;
- tenant isolation;
- deterministic behaviour;
- cost controls;
- acceptance quality;
- rollback safety.

This document supplements the existing Prysm governance pack. When speed conflicts with a product invariant, security rule, evidence rule, report lock, or release gate, the stricter governance rule wins.

> **No individual task is guaranteed to finish 55% faster. The mandatory rule is that the process must be designed, measured, and corrected toward at least a 55% cycle-time reduction without reducing acceptance quality. No speed claim may be made without recorded evidence.**

---

## 2. Authority and precedence

Use the following order of authority:

1. Prysm report immutability contract.
2. Prysm product and evidence contracts.
3. Prysm lifecycle, storage, cost, security, and release contracts.
4. This acceleration standard.
5. Work-package checklist.
6. Implementation prompt.
7. Implementation notes or model suggestions.

A lower-level instruction may not override a higher-level rule.

---

## 3. Mandatory performance targets

Every work package must record these measures.

| Measure | Required target |
|---|---:|
| Active cycle-time reduction | **≥55%** against the defined baseline |
| First-pass checklist completion | **≥90%** |
| Consolidated correction rounds | **Maximum 1** |
| Unplanned files changed | **0** |
| Aspirational checklist items | **0** |
| Checklist items without direct proof | **0** |
| Required gates skipped | **0** |
| False completion claims | **0** |
| Live provider or LLM calls in CI | **0** unless explicitly authorized |
| Report/golden-master changes | **0** unless the work package explicitly authorizes a versioned report change |

### 3.1 Cycle-time baseline

Before implementation, record a baseline using one of these methods, in order:

1. Median active cycle time of the three most comparable completed work packages.
2. Active cycle time of the most comparable completed work package.
3. A written task decomposition estimate approved before implementation.

Do not compare against calendar time that includes user absence, CI queue delays, provider outages, or unrelated work.

### 3.2 Active cycle time

Active cycle time starts when the frozen work-package prompt is issued and ends when the exact-head independent audit returns PASS.

Record separately:

- implementation time;
- local verification time;
- CI time;
- independent audit time;
- correction time;
- external waiting time.

### 3.3 Speed calculation

```text
Cycle-time reduction % = ((baseline active time - actual active time) / baseline active time) × 100
```

A package may be called “55% faster” only when the calculation is recorded.

---

## 4. Core operating rules

These rules apply to every work package.

- [ ] One measurable work package per branch and PR.
- [ ] One frozen checklist before code changes.
- [ ] One exact starting SHA.
- [ ] One explicit permitted-file list.
- [ ] One explicit prohibited-file list.
- [ ] One implementation pass.
- [ ] One local verification pass.
- [ ] One independent exact-head audit.
- [ ] Maximum one consolidated correction pass.
- [ ] One final exact-head audit after correction.
- [ ] One merge decision.
- [ ] No next work package begins before the current package is closed.

### 4.1 No piecemeal rule

Do not send isolated fixes for symptoms that belong to one architectural boundary.

Before implementation, group all confirmed defects that share the same:

- responsibility;
- state boundary;
- contract;
- storage path;
- adapter boundary;
- acceptance harness;
- failure mode.

They must be corrected in one bounded work package unless a safety or rollback constraint requires separation.

### 4.2 No aspirational language

The following wording is prohibited in work-package requirements:

- improve reliability;
- strengthen validation;
- make recovery robust;
- ensure quality;
- optimize performance;
- handle edge cases;
- improve governance;
- make deterministic;
- clean up implementation.

Replace each with an observable outcome.

Example:

```text
Prohibited: Improve recovery.
Required: Starting from collection_failed, execution appends collecting → evidence_stored → evidence_locked and calls completed adapters zero times.
```

### 4.3 Proof rule

A checklist item is valid only when it names at least one direct proof:

- exact assertion;
- exact lifecycle history;
- persisted state;
- stored artifact;
- byte count;
- SHA-256 value;
- adapter call count;
- artifact write count;
- command and exit code;
- CI run and exact head SHA;
- exact changed-file list.

Comments, test names, prose claims, and green CI alone are not proof.

---

## 5. Work-package lifecycle

Every work package follows these seven gates in order.

## Gate 0 — Intake and dependency check

- [ ] State one measurable objective.
- [ ] Identify the governing contracts.
- [ ] Identify upstream dependencies.
- [ ] Identify downstream work that must remain untouched.
- [ ] Confirm whether the work changes product behaviour, internal governance, or both.
- [ ] Confirm whether report output is expected to change.
- [ ] Record the cycle-time baseline.
- [ ] Stop if a required upstream contract is unresolved.

**Output:** short disposition, no code changes.

## Gate 1 — Frozen checklist

Create a checklist file before implementation.

Required path pattern:

```text
docs/prysm-governance/work-packages/WP##_CHECKLIST.md
```

Each checklist item must contain:

| Field | Requirement |
|---|---|
| ID | Stable identifier, such as `WP6-ADAPTER-03` |
| Requirement | One observable behaviour |
| Implementation boundary | Exact file/function/module |
| Unit proof | Exact test/assertion |
| Acceptance proof | Exact acceptance gate |
| Failure result | Exact required fail-closed behaviour |
| Evidence | What the final report must show |
| Status | `[ ]` or `[x]` only |

Checklist status is frozen when implementation begins. Any later scope addition requires:

1. stop;
2. classify as blocker, defect, or future package;
3. update the checklist version;
4. restart the baseline measurement when the addition materially changes scope.

## Gate 2 — Prompt compilation

The implementation prompt must be generated from the frozen checklist, not written from memory.

Required prompt sections:

- [ ] repository path;
- [ ] branch;
- [ ] PR number when applicable;
- [ ] exact starting SHA;
- [ ] one objective;
- [ ] permitted files;
- [ ] prohibited files;
- [ ] numbered checklist IDs;
- [ ] exact tests required;
- [ ] exact acceptance gates;
- [ ] exact verification commands;
- [ ] exact commit message;
- [ ] explicit no-merge rule;
- [ ] exact final report format;
- [ ] prohibition against claiming completion with failed items.

Do not include optional improvements. Put them in a future-work register.

## Gate 3 — Build

Implementation must follow this order:

1. Add or correct failing unit tests for every checklist behaviour.
2. Run the narrow suite and record expected failures.
3. Implement only the frozen checklist.
4. Run the narrow suite until green.
5. Build or update the acceptance harness.
6. Run the work-package acceptance command.
7. Run the full regression suite.
8. Run the scope check.
9. Review the complete diff.
10. Commit once and push once.

Do not produce a final report while any task is open or in progress.

## Gate 4 — Automated verification

Every work package must provide or use these commands:

```text
npm run wp##:preflight
npm run test:wp##
npm run acceptance:wp##
npm run wp##:scope-check
npm run wp##:verify
```

Where repository conventions require different names, preserve the same responsibilities.

`wp##:verify` must execute:

- template/golden-master integrity check;
- schema tests;
- artifact tests;
- lifecycle tests;
- work-package unit tests;
- prior acceptance suites;
- current acceptance suite;
- permitted-file check;
- prohibited-file check;
- generated-artifact check;
- no-live-provider/LLM CI check where relevant.

Any failure exits non-zero.

## Gate 5 — Independent exact-head audit

The independent auditor must inspect the actual commit, not only the implementation report.

Audit checklist:

- [ ] PR head equals reported final SHA.
- [ ] CI ran against that exact SHA.
- [ ] Changed files match the permitted list.
- [ ] Prohibited files are untouched.
- [ ] Every checklist ID has a real assertion.
- [ ] Acceptance proves runtime behaviour.
- [ ] Failure tests prove both rejection and exact persisted state.
- [ ] Lifecycle assertions use exact ordered equality.
- [ ] Adapter and artifact call counts are measured.
- [ ] SHA and byte claims are read from stored artifacts.
- [ ] No test passes through `A OR B` when only one result is governed.
- [ ] No unused variable is presented as proof.
- [ ] No missing requirement is moved into “known limitations.”
- [ ] Report and golden-master invariants remain intact.

The auditor returns only:

```text
PASS
```

or:

```text
BLOCKED — failed checklist IDs and exact evidence
```

## Gate 6 — Consolidated correction

When audit fails:

- [ ] Create one correction prompt containing only failed checklist IDs.
- [ ] Include the exact failed-head SHA.
- [ ] Keep the original scope unless a proven contract defect requires a versioned checklist update.
- [ ] Do not repeat accepted architecture.
- [ ] Do not add optional improvements.
- [ ] Add or fix proof before changing implementation when the implementation claim was unproven.
- [ ] Commit once and push once.
- [ ] Run the full verification sequence again.
- [ ] Perform one new exact-head audit.

A second correction round requires a process review before more coding.

## Gate 7 — Close and merge

Merge is permitted only when:

- [ ] every checklist item is `[x] PASS`;
- [ ] exact-head CI passes;
- [ ] independent audit returns PASS;
- [ ] work tree is clean;
- [ ] PR scope is correct;
- [ ] rollback target exists;
- [ ] the package performance record is complete;
- [ ] the next package checklist is not yet active.

---

## 6. Required checklist design

### 6.1 One behaviour per item

Do not combine independent behaviours in one checkbox.

Bad:

```text
[ ] Validate artifacts, preserve retries, and recover correctly.
```

Good:

```text
[ ] WP6-ART-01 — Raw Artifact Record passes schema validation.
[ ] WP6-ART-02 — Stored raw bytes equal Artifact Record bytes.
[ ] WP6-ART-03 — Stored raw SHA equals Artifact Record SHA.
[ ] WP6-REC-01 — Completed adapter call count is zero during recovery.
```

### 6.2 Binary completion

Each item must end as exactly one of:

```text
[x] PASS — direct evidence
[ ] FAIL — direct evidence
```

Do not use:

- partial;
- mostly complete;
- directionally correct;
- acceptable limitation;
- pass with follow-up;
- technically complete.

### 6.3 Fail-closed definition

Every negative-path item must specify:

- exact error or rejection;
- exact persisted state;
- exact events that must not exist;
- exact later operations that must have zero calls;
- exact artifacts that must not be written.

---

## 7. Test and acceptance rules

### 7.1 Unit tests

Unit tests prove isolated behaviour and contracts.

Required practices:

- exact assertions;
- one shared backing store for wrappers;
- deterministic clocks;
- deterministic IDs where required;
- ordinary untagged failures unless tags are part of the production contract;
- no live provider calls;
- no live LLM calls;
- no workstation paths;
- no generated runtime artifacts committed.

### 7.2 Acceptance tests

Acceptance tests must execute the real work-package path using controlled dependencies.

Acceptance must not rely on:

- test names;
- comments;
- source-code string searches;
- hard-coded expected gate totals;
- fake checkpoint keys;
- manually constructed success summaries;
- already completed state when interrupted recovery is being tested;
- green CI as substitute for behavioural proof.

### 7.3 Exact lifecycle rule

Use exact ordered equality:

```js
assert.deepEqual(actualStates, expectedStates);
```

Do not use containment checks when order and exclusivity matter.

### 7.4 Exact failure rule

Required:

```text
operation rejects
AND
persisted state equals governed failure state
AND
prohibited later events do not exist
AND
prohibited later calls equal zero
```

Prohibited:

```text
operation rejects OR state is correct
```

### 7.5 Permanent regression rule

Every production defect and every independently discovered false-positive test must add a permanent regression case.

---

## 8. Prompt efficiency rules

### 8.1 Prompt length

Prompts must be complete but bounded.

Include:

- only the current package;
- only confirmed blockers;
- only required files;
- only executable proof;
- only required final output.

Exclude:

- broad architecture restatements already in source files;
- optional refactors;
- future packages;
- repeated explanations;
- motivational language;
- confidence targets as substitutes for evidence.

### 8.2 Source-first rule

At the top of every future build prompt:

```text
Read and obey PRYSM_REBUILD_ACCELERATION_STANDARD_v1.0.md before editing.
Treat it as a governing source rule.
```

Then identify the exact work-package checklist file.

### 8.3 No repeated discovery

Architecture and invariant facts already established in source documents must not be rediscovered in every prompt.

Create reusable repository records for:

- canonical source statuses;
- lifecycle transitions;
- permitted artifact categories;
- report template hashes;
- golden-master hashes;
- standard regression commands;
- prohibited live-call rules;
- work-package file boundaries.

Prompts should reference these records rather than restating them.

---

## 9. Automation requirements

The following checks should be automated once and reused:

- branch and SHA preflight;
- clean-tree check;
- permitted-file diff check;
- prohibited-file diff check;
- report template hash check;
- golden-master integrity check;
- package lockfile check;
- generated-artifact check;
- secret scan;
- live-provider/LLM test-call scan;
- full regression sequence;
- work-package acceptance;
- exact-head CI lookup;
- PR open/draft/unmerged check before authorization.

Manual prompt text must not be used as the only enforcement for repeatable repository rules.

---

## 10. Work-in-progress limits

To reduce context switching:

- Maximum active Prysm implementation work packages: **1**.
- Maximum active corrective branch for that package: **1**.
- Maximum unresolved architectural decision affecting the package: **0** before build.
- Maximum consolidated correction rounds: **1**.
- Maximum files outside the permitted list: **0**.

Do not start a new chat merely because a conversation is long when the current work package is not yet closed. Start a new chat at a package boundary or when tool/context reliability materially degrades, and carry forward the exact checklist, branch, PR, and SHA.

---

## 11. Stop conditions

Stop implementation immediately when any of these occurs:

- starting SHA mismatch;
- dirty working tree not explained by the package;
- authoritative documents conflict;
- required contract does not expose enough data to prove the checklist;
- implementation requires a prohibited file;
- a report or golden-master change appears unexpectedly;
- test requires a live provider or LLM call not explicitly authorized;
- checklist scope expands materially;
- a second correction round would be required;
- exact-head CI cannot be tied to the reported commit.

When stopped, return:

```text
BLOCKED
Reason:
Failed checklist ID:
Evidence:
Smallest required decision:
```

Do not guess or work around a governance conflict.

---

## 12. Final report standard

Final reports must be checklist-based and evidence-based.

Required format:

```text
Starting SHA:
Final SHA:
PR:
Exact files changed:

[x] WP#-ID — PASS — assertion/test/artifact/state evidence
[ ] WP#-ID — FAIL — assertion/test/artifact/state evidence

Commands:
[x] command — exit 0 — exact total

Template hashes:
Golden-master result:
Exact-head CI run:
Git status:
PR state:
Cycle-time baseline:
Actual active cycle time:
Measured reduction:
Correction rounds:
```

Rules:

- No prose-only completion claim.
- No confidence percentage in place of evidence.
- No “known limitation” may contain an unmet governing requirement.
- No completion claim unless every required item is `[x] PASS`.

---

## 13. Performance review after each package

After closure, record:

| Field | Value |
|---|---|
| Work package | |
| Baseline active time | |
| Actual active time | |
| Cycle-time reduction | |
| First-pass checklist pass rate | |
| Correction rounds | |
| False-positive proofs found | |
| Unplanned files changed | |
| CI reruns caused by preventable defects | |
| Process defect to automate next | |

### 13.1 Failure to hit 55%

When measured reduction is below 55%:

1. Do not weaken acceptance criteria.
2. Identify where time was spent.
3. Classify delay as:
   - unclear scope;
   - unresolved architecture;
   - weak proof;
   - manual repeated check;
   - model implementation defect;
   - CI/runtime delay;
   - external dependency;
   - user-driven scope change.
4. Add one concrete process correction before the next package.
5. Automate repeated manual work where possible.

A missed speed target is a process defect to correct, not permission to skip governance.

---

## 14. Mandatory future workflow

From this point forward, use this sequence for every Prysm improvement:

1. **Review** the next package against authoritative documents.
2. **Resolve** architecture and contract gaps before coding.
3. **Create** the frozen work-package checklist with stable IDs.
4. **Compile** one implementation prompt from that checklist.
5. **Build** once.
6. **Verify** through narrow, acceptance, full regression, and scope commands.
7. **Commit and push** once.
8. **Audit** the exact head independently.
9. **Correct once** using only failed IDs when necessary.
10. **Audit again**.
11. **Merge only after PASS**.
12. **Record measured speed improvement**.
13. **Begin the next package only after closure**.

---

# Appendix A — Work-package checklist template

```markdown
# Prysm WP## Checklist

**Version:** 1.0.0
**Branch:**
**PR:**
**Required starting SHA:**
**Objective:**
**Baseline active cycle time:**
**55% target active cycle time:**

## Permitted files

- [ ] `path`

## Prohibited files

- [ ] `path/**`

## Requirements

### WP##-AREA-01 — Exact behaviour name

- [ ] Behaviour:
- [ ] Implementation boundary:
- [ ] Unit proof:
- [ ] Acceptance proof:
- [ ] Failure state:
- [ ] Prohibited later events/calls/writes:
- [ ] Final-report evidence:

## Verification commands

- [ ] `command`

## Completion

- [ ] All checklist IDs PASS.
- [ ] Full regression PASS.
- [ ] Scope check PASS.
- [ ] Exact-head CI PASS.
- [ ] Independent audit PASS.
- [ ] PR remains unmerged until authorized.
```

---

# Appendix B — Implementation prompt template

```text
Read and obey PRYSM_REBUILD_ACCELERATION_STANDARD_v1.0.md before editing.
Treat it as a governing source rule.

Read the frozen checklist:
[PATH TO WP CHECKLIST]

Repository:
C:\Users\kulba\Desktop\vantage-platform

Branch:
[BRANCH]

PR:
[PR]

Required starting SHA:
[SHA]

Objective:
[ONE MEASURABLE OBJECTIVE]

Complete every checklist ID in the frozen checklist.
Do not add requirements, optional refactors, or future work.
Do not modify files outside the permitted list.
Do not merge.

Required order:
1. Run preflight.
2. Add or correct failing tests for each checklist ID.
3. Confirm expected narrow-suite failures.
4. Implement the complete checklist.
5. Run narrow tests.
6. Run acceptance.
7. Run full regression.
8. Run scope check.
9. Inspect complete diff.
10. Commit once.
11. Push once.
12. Confirm exact-head CI.
13. Return the checklist report only.

A checklist item is complete only when direct proof is reported.
Do not claim completion while any item is FAIL, open, or in progress.
```

---

# Appendix C — Independent audit template

```text
Audit PR #[NUMBER] at exact head [SHA].
Do not modify or merge.

Read:
- PRYSM_REBUILD_ACCELERATION_STANDARD_v1.0.md
- [WORK-PACKAGE CHECKLIST]

For every checklist ID:
1. inspect the implementation;
2. inspect the exact assertion;
3. inspect acceptance behaviour;
4. inspect stored state/artifact/call counts where required;
5. mark PASS or BLOCKED.

Also verify:
- exact-head CI;
- permitted-file scope;
- prohibited files untouched;
- template and golden-master integrity;
- no false completion proof;
- clean PR state.

Return only:
PASS

or:
BLOCKED — failed IDs and exact evidence.
```

---

# Appendix D — Consolidated correction template

```text
Correct only these failed checklist IDs:
[FAILED IDS]

Repository:
C:\Users\kulba\Desktop\vantage-platform

Branch:
[BRANCH]

PR:
[PR]

Required starting SHA:
[FAILED HEAD SHA]

Do not revisit accepted checklist IDs unless the correction directly requires it.
Do not add scope.
Do not merge.

For each failed ID:
- add or correct direct proof;
- correct implementation only when proof demonstrates failure;
- run the complete verification sequence;
- commit once;
- push once;
- return checklist evidence only.
```

---

## 15. Adoption rule

This file becomes active when uploaded as a project source.

For all future Prysm work:

- reference this file in the first instruction;
- create the frozen checklist before implementation;
- reject aspirational requirements;
- require executable proof;
- measure cycle-time reduction;
- do not merge without independent exact-head PASS.

