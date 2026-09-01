# Platform API Contract Map — Preparation

Dokumen ini menjadi input langsung untuk diskusi berikutnya.

## 1. Tujuan Contract Map

Sebelum menulis OpenAPI penuh, kita perlu menyepakati:
- public API groups;
- shared resource endpoints;
- experience-specific query/read endpoints;
- command endpoints;
- internal worker API;
- ResourceRef/DeepLink contract;
- pagination;
- error taxonomy;
- long-running command response;
- idempotency;
- masking/access representation;
- realtime events.

## 2. Candidate Public API Groups

### Shared/Core
- `/api/v1/workspaces`
- `/api/v1/cases`
- `/api/v1/investigations`
- `/api/v1/subjects`
- `/api/v1/entities`
- `/api/v1/resolutions`
- `/api/v1/knowledge`
- `/api/v1/workflows`
- `/api/v1/runs`
- `/api/v1/evidence`
- `/api/v1/datasets`
- `/api/v1/analysis`
- `/api/v1/monitoring`
- `/api/v1/notifications`

### SHADOW Read Models
- `/api/v1/shadow/cases/:caseId/overview`
- `/api/v1/shadow/profile-inbox`
- `/api/v1/shadow/profiles/:entityId`
- `/api/v1/shadow/cases/:caseId/intelligence-feed`
- `/api/v1/shadow/cases/:caseId/timeline`

### ECHO Read Models
- `/api/v1/echo/cases/:caseId/graph`
- `/api/v1/echo/entities/:entityId/context`
- `/api/v1/echo/cases/:caseId/activity-overlay`
- `/api/v1/echo/cases/:caseId/relationship-candidates`

### SPECTRA Read Models
- `/api/v1/spectra/cases/:caseId/overview`
- `/api/v1/spectra/cases/:caseId/accounts/:entityId`
- `/api/v1/spectra/cases/:caseId/activity`
- `/api/v1/spectra/cases/:caseId/alerts`
- `/api/v1/spectra/cases/:caseId/news`

## 3. Internal Worker API Candidates

- `GET /internal/v1/runs/:runId/execution-plan`
- `POST /internal/v1/runs/:runId/attempts`
- `POST /internal/v1/runs/:runId/progress`
- `POST /internal/v1/runs/:runId/checkpoint`
- `POST /internal/v1/evidence/source-batches`
- `POST /internal/v1/analysis/results`
- `POST /internal/v1/runs/:runId/complete`

## 4. Shared Contracts yang Perlu Dikunci

### ResourceRef
Possible shape:
```text
type
id
workspaceId
caseId?
```

### DeepLinkTarget
```text
product/workspace
caseId?
investigationId?
resourceRef
view?
```

### API Error
```text
code
message
requestId
resourceRef?
details?
```

### RealtimeEvent
```text
id
type
workspaceId
caseId?
resourceRef?
timestamp
payload (minimal)
```

### IntelligenceHighlight
```text
id
caseId
source
type
severity
title
resourceRef
occurredAt
```

### CaseCapabilitySummary
```text
caseId
source/capability
summary
updatedAt
```

## 5. Command vs Query

Commands harus mewakili intention/mutation dengan jelas, misalnya:
- create Subject;
- request Resolution;
- decide Candidate;
- merge Entity;
- create Case Claim;
- promote Knowledge;
- request Run;
- start Monitoring;
- acknowledge Alert.

Queries dioptimalkan untuk UI/read requirements dan boleh aggregate beberapa domain.

## 6. Pertanyaan yang Akan Kita Bahas

1. REST noun/action style atau explicit command resources?
2. Standard ID format?
3. Cursor pagination contract?
4. Case context di path, header, atau keduanya?
5. Reason-for-access transport?
6. Idempotency-Key standard?
7. Optimistic concurrency / revision field?
8. ETag usage?
9. Long-running command: `202 Accepted + runId` contract?
10. Candidate review command shape?
11. Knowledge promotion/revision endpoints?
12. Entity merge/split endpoints?
13. Internal service authentication model?
14. SSE event naming/versioning?
15. API error taxonomy?
16. Bulk Evidence ingestion contract?
17. Search query contract?
18. Read model freshness/revision metadata?
19. Field masking representation?
20. Deep-link resolver contract?

Setelah Contract Map stabil, langkah berikutnya dapat berupa OpenAPI v1 dan development plan MVP.
