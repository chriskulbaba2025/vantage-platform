# Prysm Governed Rebuild Pack

**Version:** 1.0.0  
**Date:** 2026-08-04  
**Purpose:** Rebuild Prysm's execution pipeline without changing the approved client-facing report.

---

## 1. The decision

Do not rebuild Prysm from zero.

Rebuild the execution spine behind the existing report:

1. audit orchestration;
2. evidence collection contracts;
3. immutable artifact storage;
4. lifecycle state management;
5. Railway-to-n8n boundaries;
6. LLM cost controls;
7. production acceptance.

Preserve the useful provider clients, scoring rules, finding rules, report renderer, report design, report pages and web-viewer behaviour where they pass the new contracts.

---

## 2. Governing rule

> The pipeline may change. The approved report may not.

The current accepted report becomes **Prysm Report Design v1.0.0**.

No pipeline, provider, n8n or LLM change may alter:

- page count;
- section order;
- page titles;
- HTML structure;
- CSS;
- typography;
- colours;
- spacing;
- charts;
- tables;
- navigation;
- header;
- footer;
- CTA;
- print behaviour;
- client delivery behaviour.

A report-design change requires a separate version, approval and visual baseline.

---

## 3. Use these documents in order

1. `01_PRYSM_MASTER_REBUILD_CHARTER.md`
2. `02_PRYSM_REPORT_IMMUTABILITY_CONTRACT.md`
3. `03_PRYSM_PIPELINE_CONTRACTS_AND_STATE_MACHINE.md`
4. `04_PRYSM_N8N_AND_LLM_COST_CONTRACT.md`
5. `05_PRYSM_ACCEPTANCE_AND_RELEASE_PLAYBOOK.md`
6. `06_PRYSM_IMPLEMENTATION_BACKLOG.md`
7. `07_PRYSM_CLAUDE_CODE_WORK_ORDER.md`
8. `08_PRYSM_DECISION_AND_RISK_LOG.md`

Documents 01–05 are build gates. Do not begin production implementation until they are accepted.

---

## 4. Immediate actions

1. Freeze feature development.
2. Leave PR #30 unmerged until the repository disposition audit is complete.
3. Tag the current production state.
4. Identify the exact accepted report output.
5. Capture the report golden master.
6. Create a rebuild branch from current main.
7. Implement one governed phase at a time.
8. Do not merge a phase until its release gate passes.

---

## 5. End-state flow

```text
Web app intake
→ validated audit request
→ Railway audit orchestrator
→ independent evidence adapters
→ immutable object storage
→ canonical evidence
→ deterministic findings and scoring
→ constrained report-content package
→ one bounded n8n/LLM step
→ schema-valid narrative fields
→ locked report renderer
→ unchanged multi-page report
→ human approval
→ database and object storage
→ client-facing app
```

---

## 6. Success definition

Prysm is ready when a controlled audit can be run repeatedly without manual repair and can prove:

- the input used;
- every provider result;
- every source status;
- every stored artifact;
- every artifact hash;
- every finding;
- every score;
- every n8n call;
- every model cost;
- every report field;
- every report page;
- the approval decision;
- the final client-facing output.

The same evidence and version set must produce the same scores, findings, page structure and report design.
