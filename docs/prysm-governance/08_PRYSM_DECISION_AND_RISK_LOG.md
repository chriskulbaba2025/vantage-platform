# Prysm Decision and Risk Log

**Version:** 1.0.0

---

# 1. Decision log

| ID | Date | Decision | Reason | Alternatives rejected | Versions affected | Approved by |
|---|---|---|---|---|---|---|
| D-001 | 2026-08-04 | Rebuild execution spine, preserve report | Repeated branch-specific failures | Continue patching; full rewrite | Pipeline v2 | Pending |
| D-002 | 2026-08-04 | Lock report as v1.0.0 | Prevent design drift | Let n8n render HTML | Report design | Pending |
| D-003 | 2026-08-04 | LLM limited to narrative JSON | Preserve evidence and scores | Agentic report generation | Narrative v1 | Pending |
| D-004 | 2026-08-04 | Mock/replay default | Prevent testing cost | Live calls during testing | LLM contract | Pending |

---

# 2. Current high risks

| ID | Risk | Likelihood | Impact | Control | Owner | Status |
|---|---|---:|---:|---|---|---|
| R-001 | Report design changes during rebuild | High | Critical | Golden master and protected renderer | Principal Auditor | Open |
| R-002 | Provider branch not covered by tests | High | High | Universal adapter contract suite | Engineering | Open |
| R-003 | Railway local disk loses evidence | High | Critical | Object storage as system of record | Engineering | Open |
| R-004 | LLM testing creates runaway spend | Medium | High | Mock/replay and hard budgets | Workflow owner | Open |
| R-005 | n8n invents findings | Medium | Critical | Fixed IDs and strict schema | Workflow owner | Open |
| R-006 | Unit tests hide production failure | High | High | Layered staging acceptance | Engineering | Open |
| R-007 | Migration breaks production | Medium | Critical | Feature flag and rollback | Engineering | Open |
| R-008 | Mixed PRs cause regression | High | High | One work package per PR | Repository owner | Open |

---

# 3. Change request template

```text
Change ID:
Requested by:
Date:

Affected version:
- pipeline:
- evidence schema:
- scoring:
- prompt:
- model:
- report design:
- n8n workflow:

Reason:

Expected benefit:

Evidence:

Risks:

Tests required:

Golden-master impact:
- none
- expected
- prohibited

Cost impact:

Rollback:

Approval:
```

---

# 4. Human override record

```json
{
  "overrideId": "uuid",
  "auditId": "uuid",
  "field": "string",
  "previousValue": null,
  "replacementValue": null,
  "reason": "string",
  "userId": "uuid",
  "createdAt": "ISO-8601",
  "evidenceReferences": []
}
```

---

# 5. Phase approval template

```text
Phase:
Commit:
PR:
Release record:
Contracts passed:
Acceptance passed:
Golden master passed:
Live provider calls:
Live LLM calls:
Provider cost:
LLM cost:
Known limitations:
Rollback target:
Approved by:
Approved at:
```
