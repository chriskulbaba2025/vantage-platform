# Prysm Pipeline Contracts and State Machine

**Version:** 1.0.0  
**Status:** Mandatory implementation contract

---

# 1. Contract chain

```text
AuditRequest
→ SourceExecutionResult[]
→ CanonicalEvidence
→ FindingSet
→ ScoreSet
→ ReportContentPackage
→ NarrativeResponse
→ ReportViewModel
→ ReportArtifactManifest
```

Every step:

- has a JSON Schema;
- has a version;
- rejects invalid input;
- has valid and invalid fixtures;
- is stored as an immutable artifact when used in an approved report.

---

# 2. Audit Request Contract

Required concepts:

- audit ID;
- tenant ID;
- client ID;
- idempotency key;
- target URL;
- business name;
- market;
- language;
- primary goal;
- services;
- competitors;
- optional GA4 property;
- optional GSC property;
- crawl configuration.

Rules:

- normalize the URL before hashing;
- reject secrets in the payload;
- prevent duplicate audit creation with the same idempotency key;
- preserve submitted and normalized values separately.

---

# 3. Universal Source Result Contract

Every provider returns:

```json
{
  "schemaVersion": "1.0.0",
  "source": "dataforseo-onpage",
  "provider": "DataForSEO",
  "adapterVersion": "1.1.0",
  "status": "AVAILABLE",
  "startedAt": "ISO-8601",
  "completedAt": "ISO-8601",
  "requestId": "provider-task-id",
  "retryCount": 0,
  "expectedRecords": 20,
  "returnedRecords": 20,
  "coverage": {
    "requested": 20,
    "completed": 20,
    "failed": 0
  },
  "limitations": [],
  "artifact": {
    "key": "audits/.../raw/dataforseo-onpage.json",
    "sha256": "64-character-hash",
    "bytes": 12345,
    "contentType": "application/json"
  },
  "evidence": {}
}
```

Allowed statuses:

- `AVAILABLE`
- `PARTIAL`
- `FAILED`
- `BLOCKED`
- `UNAVAILABLE`
- `NOT_CONNECTED`
- `NOT_APPLICABLE`

Rules:

- status is required;
- artifact is required when provider bytes were received;
- `BLOCKED` is not `FAILED`;
- `PARTIAL` includes coverage and limitation;
- `FAILED` preserves task ID when available;
- an adapter cannot set an audit score.

---

# 4. Artifact contract

Object keys follow:

```text
tenants/{tenantId}/clients/{clientId}/audits/{auditId}/
  raw/{source}/{executionId}.json
  normalized/{source}.json
  canonical/evidence.json
  canonical/findings.json
  canonical/scores.json
  report/report-content.json
  report/narrative.json
  report/draft/{page}.html
  report/approved/{page}.html
  manifests/audit-manifest.json
```

Rules:

- calculate SHA from exact stored bytes;
- read the object back in staging acceptance;
- verify bytes and SHA;
- never record a path before a successful write;
- do not replace required storage with a synthetic URI;
- storage failure is surfaced.

---

# 5. Canonical Evidence Contract

Contains:

- audit identity;
- normalized request;
- all source status records;
- normalized page evidence;
- performance evidence;
- competitor evidence;
- backlink evidence;
- GA4 evidence;
- GSC evidence;
- limitations;
- artifact references;
- evidence version;
- adapter versions;
- creation timestamp.

It does not contain client-facing prose, HTML, CSS or LLM output.

Once locked, it is immutable.

---

# 6. Finding Contract

Every finding requires:

- finding ID;
- rule ID and version;
- dimension;
- module;
- title;
- affected URLs;
- one or more evidence references;
- confidence;
- business impact;
- recommendation;
- implementation effort;
- verification method;
- score-bearing flag.

Rules:

- no evidence reference means no finding;
- an LLM cannot create or remove a finding;
- finding IDs exist before n8n;
- authoritative recommendations remain deterministic.

---

# 7. Score Contract

Contains:

- scoring version;
- dimension scores;
- module scores;
- score eligibility;
- assessed weight;
- overall score or insufficiency message;
- evidence confidence;
- source dependencies;
- exact finding IDs included.

Rules:

- no silent reweighting;
- optional-source absence cannot lower unrelated scores;
- scoring is deterministic;
- below evidence thresholds, the score is provisional or suppressed.

---

# 8. Report Content Package

This is the only payload sent to n8n.

It contains:

- audit and business identity needed for the report;
- locked scores;
- approved finding IDs;
- deterministic finding facts;
- section assignments;
- limitations;
- source-status summary;
- fixed field limits;
- prompt version;
- output schema version.

It excludes raw provider payloads, HTML, CSS, screenshots, secrets and debug logs.

---

# 9. Narrative Response Contract

The response:

- contains only allowed fields;
- references existing finding IDs;
- stays within field limits;
- contains no HTML or CSS;
- cannot alter scores;
- cannot add URLs;
- cannot add findings;
- cannot add report sections.

Unknown fields fail validation.

---

# 10. Report View Model

The worker combines:

- deterministic report content;
- validated narrative response;
- locked report metadata.

The renderer accepts only this view model.

---

# 11. State machine

## Normal path

```text
CREATED
→ VALIDATED
→ COLLECTING
→ EVIDENCE_STORED
→ EVIDENCE_LOCKED
→ SCORED
→ NARRATIVE_PENDING
→ NARRATIVE_READY
→ DRAFT_RENDERED
→ IN_REVIEW
→ APPROVED
→ PUBLISHED
```

## Controlled failures

- `VALIDATION_FAILED`
- `COLLECTION_FAILED`
- `NARRATIVE_FAILED`
- `RENDER_FAILED`
- `APPROVAL_REJECTED`
- `PUBLISH_FAILED`

Only the orchestrator changes audit state.

Every transition is append-only and records audit ID, prior state, next state, timestamp, actor, reason, execution ID and version.

---

# 12. Idempotency and replay

Source execution key:

```text
auditId + source + adapterVersion + normalized source configuration hash
```

Narrative cache key:

```text
reportContentSha256 + promptVersion + modelId + outputSchemaVersion
```

Renderer replay key:

```text
reportViewModelSha256 + reportDesignVersion
```

Replaying identical inputs must not repeat provider or model charges unless explicitly forced.

---

# 13. Security boundary

- credentials stay in encrypted secret storage;
- credentials never enter artifacts or n8n payloads;
- GA4 and GSC use read-only access;
- no user-level GA4 records are stored;
- object keys are tenant-scoped;
- report routes validate tenant and approval state;
- path traversal is rejected;
- human overrides are append-only and attributed.
