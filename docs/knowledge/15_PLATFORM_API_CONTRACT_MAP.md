# Platform API Contract Map v1

**Status:** Baseline locked for implementation planning  
**Audience:** Backend, frontend, worker/runtime, QA, security, product, platform engineering

## 1. Purpose

Platform API Contract Map menjembatani architecture domain dengan implementasi API konkret tanpa mengubah ownership domain yang sudah dikunci.

Prinsip utama:

> **Canonical writes mengikuti domain ownership. Experience-specific reads boleh mengikuti kebutuhan SHADOW, ECHO, dan SPECTRA.**

SHADOW, ECHO, dan SPECTRA tidak mempunyai silo write API sendiri. Endpoint seperti `shadow/create-person`, `echo/save-relationship`, atau `spectra/create-profile` harus dihindari.

## 2. API Surfaces

```text
Platform API
├── Public Core API
│   ├── canonical resources
│   └── domain commands/actions
│
├── Experience Query API
│   ├── SHADOW Queries
│   ├── ECHO Queries
│   └── SPECTRA Queries
│
├── Search API
├── Realtime API
└── Internal Worker API
```

### Public API

```text
/api/v1/*
```

Digunakan oleh `platform-web` dan future trusted clients.

### Internal API

```text
/internal/v1/*
```

Digunakan oleh worker/service identity. Browser tidak boleh mengakses surface ini.

### Realtime

```text
GET /api/v1/realtime/events
```

MVP menggunakan Server-Sent Events (SSE).

---

## 3. Shared Contract Primitives

### 3.1 ResourceRef

Pointer generic ke canonical resource tanpa menyalin object.

```ts
type ResourceRef = {
  type: string;
  id: string;
  workspaceId: string;
  caseId?: string;
};
```

Digunakan oleh:
- Notification;
- IntelligenceHighlight;
- DeepLinkTarget;
- Audit;
- Evidence/Knowledge links;
- Analysis results;
- CaseResourceReference.

### 3.2 DeepLinkTarget

Logical navigation target, bukan URL fisik.

```ts
type DeepLinkTarget = {
  product: "SHADOW" | "ECHO" | "SPECTRA";
  workspaceId: string;
  caseId?: string;
  investigationId?: string;
  resource?: ResourceRef;
  view?: string;
  params?: Record<string, string>;
};
```

Tujuan: deployment dapat berubah dari hybrid shell ke app terpisah tanpa mengubah domain data yang menyimpan link.

### 3.3 IntelligenceHighlight

```ts
type IntelligenceHighlight = {
  id: string;
  caseId: string;
  source: string;
  type: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  summary?: string;
  primaryResource: ResourceRef;
  relatedResources?: ResourceRef[];
  deepLink?: DeepLinkTarget;
  occurredAt: string;
  createdAt: string;
};
```

### 3.4 CaseCapabilitySummary

Shared summary agar SHADOW tidak hard-code internal ECHO/SPECTRA/future service.

```ts
type CaseCapabilitySummary = {
  caseId: string;
  capability: string;
  provider: string;
  status: "ACTIVE" | "INACTIVE" | "DEGRADED";
  metrics: Record<string, string | number | boolean>;
  highlights: IntelligenceHighlight[];
  updatedAt: string;
};
```

---

## 4. Identifier Strategy

Gunakan **UUIDv7** sebagai opaque canonical primary ID.

Human-readable code disimpan terpisah.

```text
id: UUIDv7
caseCode: CASE-2026-00124
```

Jangan menggunakan `CASE-001` atau sequential database integer sebagai global resource identity.

---

## 5. Standard HTTP Semantics

| Situation | Status |
|---|---:|
| Synchronous resource creation | `201 Created` |
| Normal successful read/update | `200 OK` |
| Successful command without body | `204 No Content` |
| Long-running operation accepted | `202 Accepted` |
| Validation error | `400 Bad Request` |
| Invalid/missing authentication | `401 Unauthorized` |
| Access denied | `403 Forbidden` |
| Missing or intentionally undisclosed resource | `404 Not Found` |
| Domain/idempotency conflict | `409 Conflict` |
| Optimistic concurrency mismatch | `412 Precondition Failed` |
| Rate limited | `429 Too Many Requests` |

Governance dapat memilih `404` untuk menghindari existence disclosure.

---

## 6. Error Contract

```json
{
  "error": {
    "code": "CANDIDATE_ALREADY_RESOLVED",
    "message": "Candidate has already been resolved.",
    "requestId": "req_...",
    "resource": {
      "type": "CANDIDATE",
      "id": "...",
      "workspaceId": "..."
    },
    "details": {}
  }
}
```

Frontend harus mengambil keputusan programatik berdasarkan `code`, bukan parsing `message`.

Recommended namespaces:

```text
AUTH_*
ACCESS_*
CASE_*
SUBJECT_*
RESOLUTION_*
CANDIDATE_*
ENTITY_*
KNOWLEDGE_*
EVIDENCE_*
DATASET_*
ANALYSIS_*
MONITORING_*
WORKFLOW_*
RUN_*
SOURCE_*
CONNECTOR_*
VALIDATION_*
CONFLICT_*
```

---

## 7. Pagination

Default high-volume contract: **cursor pagination**.

Request:

```text
?limit=50&cursor=<opaque-cursor>
```

Response:

```json
{
  "items": [],
  "page": {
    "nextCursor": "...",
    "hasMore": true
  }
}
```

Offset pagination hanya untuk low-volume/admin use case bila memang dibutuhkan.

---

## 8. Optimistic Concurrency

Mutable canonical resource mempunyai `revision`.

```json
{
  "id": "...",
  "revision": 12
}
```

HTTP response dapat membawa:

```http
ETag: "12"
```

Mutation:

```http
If-Match: "12"
```

Stale mutation menghasilkan `412`.

Distinction:
- `revision` = concurrency state resource;
- `version` = semantic definition/model version.

---

## 9. Idempotency

Important `POST`/domain commands menerima:

```http
Idempotency-Key: <client-generated-UUID>
```

Khususnya:
- create Case;
- create Subject;
- execute Node;
- resolve Candidate;
- merge Entity;
- promote Knowledge;
- create MonitoringTarget;
- long export.

---

## 10. Sensitive Field Contract

Backend, bukan frontend, menentukan field visibility.

```json
{
  "type": "NATIONAL_ID",
  "visibility": "MASKED",
  "displayValue": "3374••••••••8291",
  "classification": "RESTRICTED"
}
```

Possible visibility:
- `FULL`
- `MASKED`
- `MATCH_ONLY`
- `HIDDEN`

`MATCH_ONLY` dapat memberikan:

```json
{
  "type": "NATIONAL_ID",
  "visibility": "MATCH_ONLY",
  "matchStatus": "EXACT_MATCH"
}
```

Ini mengimplementasikan prinsip **permission to use ≠ permission to view**.

---

## 11. Reason For Access

Untuk restricted operation, `reasonForAccess` adalah business/audit context, bukan sekadar transport header.

Contoh:

```json
{
  "reasonForAccess": "Identity verification for CASE-2026-00124"
}
```

User identity tidak dikirim client secara manual; berasal dari authenticated principal.

---

## 12. Core Resource Groups

### Workspace / Case

```text
POST   /api/v1/cases
GET    /api/v1/cases
GET    /api/v1/cases/{caseId}
PATCH  /api/v1/cases/{caseId}
POST   /api/v1/cases/{caseId}/actions/close
POST   /api/v1/cases/{caseId}/actions/reopen
POST   /api/v1/cases/{caseId}/actions/archive
```

### Investigation

```text
POST  /api/v1/cases/{caseId}/investigations
GET   /api/v1/cases/{caseId}/investigations
GET   /api/v1/investigations/{investigationId}
PATCH /api/v1/investigations/{investigationId}
```

### Subject

```text
POST  /api/v1/cases/{caseId}/subjects
GET   /api/v1/cases/{caseId}/subjects
GET   /api/v1/subjects/{subjectId}
PATCH /api/v1/subjects/{subjectId}
POST  /api/v1/subjects/{subjectId}/actions/start-resolution
```

### Resolution / Candidate

```text
GET  /api/v1/resolutions/{resolutionId}
GET  /api/v1/resolutions/{resolutionId}/candidates
GET  /api/v1/resolutions/{resolutionId}/matches
GET  /api/v1/candidates/{candidateId}
POST /api/v1/candidates/{candidateId}/actions/resolve
```

Candidate decisions:
- `LINK_EXISTING`
- `CREATE_NEW`
- `UNCERTAIN`
- `REJECT`

### Entity Registry

```text
GET  /api/v1/workspaces/{workspaceId}/entities
POST /api/v1/workspaces/{workspaceId}/entities
GET  /api/v1/entities/{entityId}
PATCH /api/v1/entities/{entityId}
GET  /api/v1/entities/{entityId}/identifiers
POST /api/v1/entities/{entityId}/identifiers
POST /api/v1/entities/{survivorEntityId}/actions/merge
POST /api/v1/entity-merges/{mergeId}/actions/reverse
```

Normal identity creation path tetap Candidate → Resolution → Entity. Direct `POST Entity` adalah restricted manual curation/import path.

### Knowledge

```text
POST /api/v1/cases/{caseId}/claims
GET  /api/v1/cases/{caseId}/claims
POST /api/v1/cases/{caseId}/relationships
GET  /api/v1/cases/{caseId}/relationships

GET /api/v1/workspaces/{workspaceId}/knowledge/claims
GET /api/v1/workspaces/{workspaceId}/knowledge/relationships

POST /api/v1/claims/{claimId}/actions/promote
POST /api/v1/relationships/{relationshipId}/actions/promote
POST /api/v1/claims/{claimId}/actions/revise
POST /api/v1/relationships/{relationshipId}/actions/revoke
```

Promotion membuat workspace artifact baru dengan lineage; tidak hanya mengubah `scope` record lama.

### Relationship Candidates

```text
GET  /api/v1/cases/{caseId}/relationship-candidates
POST /api/v1/relationship-candidates/{id}/actions/confirm
POST /api/v1/relationship-candidates/{id}/actions/reject
POST /api/v1/relationship-candidates/{id}/actions/investigate
POST /api/v1/relationship-candidates/{id}/actions/investigate-target
```

### Evidence

```text
GET /api/v1/evidence/{evidenceId}
GET /api/v1/cases/{caseId}/evidence
GET /api/v1/evidence/{evidenceId}/lineage
GET /api/v1/evidence/{evidenceId}/raw
```

Raw endpoint mempunyai governance berbeda dan bisa disabled per source policy.

### Dataset

```text
GET  /api/v1/datasets/{datasetId}
GET  /api/v1/cases/{caseId}/datasets
POST /api/v1/cases/{caseId}/dataset-views
POST /api/v1/dataset-views/{viewId}/actions/snapshot
```

### Analysis

```text
GET  /api/v1/analysis-definitions
POST /api/v1/datasets/{datasetId}/analyses
GET  /api/v1/analyses/{analysisId}
GET  /api/v1/analyses/{analysisId}/results
```

Long-running analysis → `202 + analysisId + runId`.

### Monitoring

```text
POST /api/v1/cases/{caseId}/monitoring-targets
GET  /api/v1/cases/{caseId}/monitoring-targets
GET  /api/v1/monitoring-targets/{id}
POST /api/v1/monitoring-targets/{id}/actions/pause
POST /api/v1/monitoring-targets/{id}/actions/resume
POST /api/v1/monitoring-targets/{id}/actions/stop
POST /api/v1/monitoring-targets/{id}/schedules
POST /api/v1/monitoring-targets/{id}/rules
```

### Alerts

```text
GET  /api/v1/cases/{caseId}/alerts
GET  /api/v1/alerts/{alertId}
POST /api/v1/alerts/{id}/actions/acknowledge
POST /api/v1/alerts/{id}/actions/investigate
POST /api/v1/alerts/{id}/actions/resolve
POST /api/v1/alerts/{id}/actions/dismiss
```

### Workflow / Execution

```text
GET    /api/v1/node-definitions
GET    /api/v1/node-definitions/{key}/versions/{version}
GET    /api/v1/investigations/{id}/workflow
POST   /api/v1/investigations/{id}/nodes
PATCH  /api/v1/nodes/{nodeInstanceId}
DELETE /api/v1/nodes/{nodeInstanceId}
POST   /api/v1/nodes/{nodeInstanceId}/input-bindings
POST   /api/v1/investigations/{id}/workflow-edges
POST   /api/v1/nodes/{nodeInstanceId}/actions/run

GET  /api/v1/runs/{runId}
GET  /api/v1/cases/{caseId}/runs
POST /api/v1/runs/{runId}/actions/cancel
POST /api/v1/runs/{runId}/actions/retry
```

### Sources

```text
GET /api/v1/data-sources
GET /api/v1/data-sources/{sourceId}
GET /api/v1/capabilities
GET /api/v1/capabilities/{capability}/connectors
GET /api/v1/connectors/{connectorId}
```

Public response tidak expose credentials/internal endpoint details.

---

## 13. Experience Query APIs

### SHADOW

```text
GET /api/v1/shadow/cases/{caseId}/overview
GET /api/v1/shadow/cases/{caseId}/profile-inbox
GET /api/v1/shadow/profiles
GET /api/v1/shadow/profiles/{entityId}
GET /api/v1/shadow/cases/{caseId}/intelligence-feed
GET /api/v1/shadow/cases/{caseId}/timeline
```

### ECHO

```text
GET /api/v1/echo/cases/{caseId}/graph
GET /api/v1/echo/entities/{entityId}/context
GET /api/v1/echo/cases/{caseId}/activity-correlations
GET /api/v1/echo/cases/{caseId}/knowledge-conflicts
GET /api/v1/echo/cases/{caseId}/resolution-queue
```

Graph response harus memisahkan layers:
- Workspace Knowledge;
- Case Knowledge;
- Relationship Candidates;
- Activity/Analysis Overlay.

### SPECTRA

```text
GET /api/v1/spectra/cases/{caseId}/overview
GET /api/v1/spectra/cases/{caseId}/entities/{entityId}
GET /api/v1/spectra/cases/{caseId}/activity
GET /api/v1/spectra/cases/{caseId}/news
GET /api/v1/spectra/cases/{caseId}/sentiment
GET /api/v1/spectra/cases/{caseId}/engagement
GET /api/v1/spectra/cases/{caseId}/interactions
GET /api/v1/spectra/cases/{caseId}/coordination
GET /api/v1/spectra/cases/{caseId}/alerts
```

Experience endpoints adalah read models, bukan domain ownership.

---

## 14. Search API

Gunakan platform search contract, bukan Elasticsearch passthrough.

```text
POST /api/v1/search
```

Example:

```json
{
  "query": "Ahmad Wijaya",
  "scope": {
    "workspaceId": "...",
    "caseId": "..."
  },
  "types": ["ENTITY", "EVIDENCE", "FINDING"],
  "limit": 20,
  "cursor": null
}
```

Governance filter diterapkan sebelum disclosure. Elasticsearch `_score` tidak boleh ditampilkan sebagai identity confidence.

---

## 15. Internal Worker API

```text
GET  /internal/v1/runs/{runId}/execution-plan
POST /internal/v1/runs/{runId}/attempts
POST /internal/v1/runs/{runId}/progress
PUT  /internal/v1/runs/{runId}/checkpoint
POST /internal/v1/runs/{runId}/actions/complete
POST /internal/v1/runs/{runId}/actions/fail

POST /internal/v1/evidence/source-batches
POST /internal/v1/analysis/results
```

Worker memakai service principal, bukan browser user token.

Source batch harus idempotent dengan `runId + batchId` dan source record identity.

---

## 16. Realtime Contract

SSE:

```text
GET /api/v1/realtime/events
```

Minimal event:

```json
{
  "id": "...",
  "type": "RUN_PROGRESS_UPDATED",
  "version": 1,
  "timestamp": "...",
  "caseId": "...",
  "resource": {
    "type": "RUN",
    "id": "...",
    "workspaceId": "...",
    "caseId": "..."
  },
  "payload": {
    "status": "RUNNING",
    "stage": "COLLECTING",
    "processed": 1200
  }
}
```

Event namespaces:
- `RUN_*`
- `SUBJECT_*`
- `CANDIDATE_*`
- `ENTITY_*`
- `KNOWLEDGE_*`
- `DATASET_*`
- `ANALYSIS_*`
- `MONITORING_*`
- `ALERT_*`
- `NOTIFICATION_*`

Realtime event membawa minimal data; client refetch canonical resource.

---

## 17. Long-Running Operation Standard

Jika operation menggunakan shared Workflow/Execution:

```http
HTTP/1.1 202 Accepted
```

```json
{
  "operation": {
    "type": "RUN",
    "id": "...",
    "status": "QUEUED"
  }
}
```

Tidak semua action harus menjadi Run. Update sederhana, notification read, alert acknowledge, dan metadata edit tetap synchronous.

---

## 18. Contract Invariants

1. Experience endpoint tidak mengubah domain ownership.
2. Public API tidak expose DB schema atau Elasticsearch DSL.
3. Worker tidak menulis business DB langsung.
4. Sensitive field masking ditentukan server.
5. `ResourceRef` tidak berarti access granted; authorization selalu diperiksa ulang.
6. Long-running operation harus traceable ke `Run` bila menggunakan execution pipeline.
7. Search relevance tidak sama dengan identity confidence.
8. Cross-case existence disclosure dan cross-case context view adalah permission berbeda.
9. API version, resource revision, NodeDefinition version, connector version, dan model version adalah konsep berbeda.
10. Error code harus stabil dan machine-readable.
