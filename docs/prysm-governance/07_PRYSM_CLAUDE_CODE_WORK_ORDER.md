# Prysm Claude Code Work Order

Use this template for every rebuild work package.

Do not give Claude broad instructions such as “fix the pipeline.”

---

# Master template

```text
You are working in:

Repository:
C:\Users\kulba\Desktop\vantage-platform

Project:
Prysm governed rebuild

Authoritative documents:
- docs/prysm-governance/01_PRYSM_MASTER_REBUILD_CHARTER.md
- docs/prysm-governance/02_PRYSM_REPORT_IMMUTABILITY_CONTRACT.md
- docs/prysm-governance/03_PRYSM_PIPELINE_CONTRACTS_AND_STATE_MACHINE.md
- docs/prysm-governance/04_PRYSM_N8N_AND_LLM_COST_CONTRACT.md
- docs/prysm-governance/05_PRYSM_ACCEPTANCE_AND_RELEASE_PLAYBOOK.md
- docs/prysm-governance/06_PRYSM_IMPLEMENTATION_BACKLOG.md

Current work package:
[INSERT EXACT WORK PACKAGE]

Goal:
[INSERT ONE MEASURABLE GOAL]

Permitted files:
[LIST FILES OR DIRECTORIES]

Prohibited changes:
- Do not alter approved report HTML, CSS, assets, pages, layout or styling.
- Do not alter scoring unless explicitly authorized.
- Do not change n8n unless explicitly authorized.
- Do not add product features.
- Do not make live provider calls in unit or CI tests.
- Do not make live LLM calls in unit, integration or CI tests.
- Do not hardcode workstation paths.
- Do not commit generated artifacts.
- Do not hide persistence or provider failures.
- Do not merge.

Required process:
1. Read the authoritative documents.
2. Inspect the current implementation.
3. Produce a short disposition before editing:
   - files affected;
   - current responsibility;
   - contract violation;
   - proposed correction;
   - risks.
4. Implement only the work package.
5. Add production-shaped tests.
6. Run narrow tests.
7. Run the full suite.
8. Run the work-package acceptance command.
9. Review the diff for scope violations.
10. Self-evaluate every acceptance criterion.
11. If confidence is below 97%, continue correcting.

Required acceptance:
[PASTE THE WORK-PACKAGE GATE]

Return only:
- branch name;
- commit SHA;
- PR number;
- exact test totals;
- acceptance results;
- files changed;
- confirmation report files were untouched;
- confirmation no generated artifacts were committed;
- remaining limitations.

Do not merge.
```

---

# Repository disposition prompt

```text
Audit the current Prysm repository against the governed rebuild documents.

Do not change code.

Classify each relevant module as:
- KEEP
- REFACTOR
- REPLACE
- REMOVE
- UNVERIFIED

For each module report:
- current responsibility;
- dependencies;
- production evidence;
- contract violations;
- report-design risk;
- cost risk;
- recommended disposition;
- migration order.

Cover:
- audit API;
- run-audit;
- all source adapters;
- artifact storage;
- scoring;
- findings;
- report rendering;
- approval;
- n8n payload code;
- tests;
- scripts;
- database persistence.

Return:
- Markdown disposition report;
- architecture map;
- dependency map;
- risk register;
- recommended first implementation PR.

Do not edit or merge anything.
```

---

# Existing PR review prompt

```text
Review PR #[NUMBER] against the Prysm governed rebuild documents.

Do not modify or merge it.

Check:
- scope;
- contract compliance;
- report immutability;
- artifact persistence;
- machine-independent tests;
- no generated artifacts;
- no hidden failures;
- no live LLM calls in tests;
- deterministic behaviour;
- rollback safety.

Return:
- ACCEPT
- AMEND
- REJECT

Then list only the blocking reasons and exact correction required.
```

---

# Completion standard

Success requires more than test totals.

Verify:

- contract compliance;
- physical artifact where relevant;
- exact bytes and SHA;
- state transitions;
- report lock;
- cost mode;
- acceptance output;
- clean Git diff.
