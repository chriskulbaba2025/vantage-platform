Prysm Governed Rebuild — Current Status



Authoritative specification:

docs/Vantage\_Production\_PRD\_v3.md



Governing acceleration standard:

docs/prysm-governance/PRYSM\_REBUILD\_ACCELERATION\_STANDARD\_v1.1.md



Repository:

chriskulbaba2025/vantage-platform



Current branch:

feat/prysm-wp8-report-content-package

Current PR:

TBD

Current verified starting head:

be9b53f2688cb3d0aa63ae3daba7e0d0c248a933

Current work package:

WP8 — Compact Report Content Package



Execution rules:

Read the full PRD before changing code.

Read and obey the Prysm Rebuild Acceleration Standard before changing code.

Complete one governed work package at a time.

Do not begin WP6.

Audit the actual final diff against the governing sources.

Fix confirmed WP5 checklist defects before reporting completion.

Run the full required verification sequence.

Do not merge without explicit authorization.

Do not change reporting logic, report templates, golden-master files, scoring, findings, schemas, WP2-WP4 governed modules, CI configuration, or deployment files unless explicitly authorized by the frozen work-package scope.



\# Prysm Governing Rules



Before performing any Prysm planning, implementation, correction, testing, audit, or merge work:



1\. Read `docs/prysm-governance/PRYSM\_REBUILD\_ACCELERATION\_STANDARD\_v1.1.md`.

2\. Treat it as a governing source rule.

3\. Its requirements override implementation suggestions and task-level shortcuts.

4\. Do not begin implementation until the current work-package checklist, branch, PR, and exact starting SHA have been verified.

5\. Do not merge or begin the next work package without explicit authorization.

