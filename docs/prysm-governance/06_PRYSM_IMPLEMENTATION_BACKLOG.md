# Prysm Governed Implementation Backlog

**Version:** 1.0.0  
**Purpose:** Execute the rebuild in a fixed order without scope drift.

---

# Operating rules

- Complete one work package at a time.
- Do not begin the next package until the gate passes.
- Do not change report design.
- Do not add features during the rebuild.
- Do not merge mixed-scope PRs.
- Use mock or replay unless live acceptance is explicitly required.

---

# Work Package 0 — Freeze the baseline

- [ ] Create a production tag from current main.
- [ ] Record the current Railway commit.
- [ ] Export the current n8n workflow.
- [ ] Record the current database schema.
- [ ] Identify the accepted report run.
- [ ] Copy accepted HTML, CSS and assets.
- [ ] Capture page and print screenshots.
- [ ] Create the golden-master manifest.
- [ ] Record deterministic test fixtures.
- [ ] Classify PR #30 as reference, merge candidate or obsolete.

**Gate:** No production code changes.

---

# Work Package 1 — Repository disposition audit

Classify relevant files:

- `KEEP`
- `REFACTOR`
- `REPLACE`
- `REMOVE`
- `UNVERIFIED`

Cover:

- audit API;
- `run-audit`;
- all source adapters;
- artifact storage;
- scoring;
- findings;
- report rendering;
- approval;
- n8n payload preparation;
- tests;
- scripts;
- database persistence.

**Gate:** Disposition report approved before coding.

---

# Work Package 2 — Schemas and fixtures

- [ ] Audit Request schema.
- [ ] Source Result schema.
- [ ] Artifact Record schema.
- [ ] Canonical Evidence schema.
- [ ] Finding schema.
- [ ] Score schema.
- [ ] Report Content schema.
- [ ] Narrative Response schema.
- [ ] Report View Model schema.
- [ ] Report Manifest schema.
- [ ] Valid fixtures.
- [ ] Invalid fixtures.
- [ ] Schema test command.

**Gate:** All schemas compile and fixtures behave correctly.

---

# Work Package 3 — Artifact Store

- [ ] interface;
- [ ] memory implementation;
- [ ] temporary-file implementation;
- [ ] object-storage implementation;
- [ ] exact-byte SHA;
- [ ] read-back verification;
- [ ] immutable naming;
- [ ] tenant scoping;
- [ ] failure propagation;
- [ ] remove adapter-owned permanent writes.

**Gate:** Artifact acceptance suite passes.

---

# Work Package 4 — State machine

- [ ] state enum;
- [ ] allowed-transition map;
- [ ] append-only log;
- [ ] idempotency;
- [ ] resumable source plan;
- [ ] controlled failure states;
- [ ] database persistence;
- [ ] transition tests.

**Gate:** Invalid transitions fail and resume behaves predictably.

---

# Work Package 5 — Audit Orchestrator

- [ ] source plan builder;
- [ ] independent source execution;
- [ ] timeout policy;
- [ ] retry policy;
- [ ] artifact persistence;
- [ ] canonical evidence assembly;
- [ ] evidence lock;
- [ ] lifecycle integration;
- [ ] concise execution summary.

**Gate:** A full mocked audit reaches `EVIDENCE_LOCKED`.

---

# Work Package 6 — Adapter migration

Migrate in this order:

1. DataForSEO On-Page;
2. PageSpeed and Lighthouse;
3. DataForSEO SERP;
4. backlinks;
5. GA4;
6. GSC.

Each adapter must prove success, partial, blocked/unavailable where relevant, failure, normalized evidence and artifact preservation.

**Gate:** Universal adapter contract suite passes.

---

# Work Package 7 — Deterministic findings and scores

- [ ] canonical evidence lock;
- [ ] module gates;
- [ ] finding evidence validation;
- [ ] assessed-weight logic;
- [ ] no-silent-reweighting;
- [ ] evidence confidence;
- [ ] deterministic priority;
- [ ] version identifiers;
- [ ] repeatability tests.

**Gate:** Identical fixtures produce identical results.

---

# Work Package 8 — Compact Report Content Package

- [ ] fixed section assignments;
- [ ] deterministic factual fields;
- [ ] narrative limits;
- [ ] source-status summary;
- [ ] limitation inputs;
- [ ] no raw provider payload;
- [ ] package hash;
- [ ] schema validation.

**Gate:** Complete for language generation and incapable of layout control.

---

# Work Package 9 — n8n narrative workflow

- [ ] linear workflow;
- [ ] input validation;
- [ ] cache check;
- [ ] cost preflight;
- [ ] one primary call;
- [ ] JSON validation;
- [ ] one optional repair;
- [ ] usage ledger;
- [ ] replay mode;
- [ ] mock mode;
- [ ] versioned export.

**Gate:** Repeated replay tests cost zero.

---

# Work Package 10 — Locked renderer

- [ ] Report View Model;
- [ ] unchanged renderer;
- [ ] page generation;
- [ ] artifact manifest;
- [ ] draft access block;
- [ ] approval gate;
- [ ] approved publication;
- [ ] golden-master tests.

**Gate:** No unauthorized report drift.

---

# Work Package 11 — Web app integration

- [ ] URL and business fields;
- [ ] competitor fields;
- [ ] GA4/GSC selection;
- [ ] audit status;
- [ ] source-status display;
- [ ] draft review;
- [ ] approval action;
- [ ] approved report viewer;
- [ ] database history.

**Gate:** Full flow works without shell access.

---

# Work Package 12 — End-to-end acceptance

- [ ] one acceptance command;
- [ ] all source states;
- [ ] artifact verification;
- [ ] n8n replay;
- [ ] budget guard;
- [ ] report golden master;
- [ ] approval and publication;
- [ ] release record.

**Gate:** All staging checks pass.

---

# Work Package 13 — Controlled pilot

- [ ] five to ten audits;
- [ ] false positives recorded;
- [ ] false negatives recorded;
- [ ] provider failures recorded;
- [ ] cost recorded;
- [ ] run time recorded;
- [ ] review time recorded;
- [ ] report quality recorded;
- [ ] launch versions frozen.

**Gate:** Principal Auditor launch approval.
