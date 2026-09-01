# OpenAPI Domain Skeleton v1

**Status:** Structural baseline; belum field-complete OpenAPI specification.  
**Goal:** Menguji apakah domain, resource, command, asynchronous execution, dan experience read models telah memiliki surface API yang konsisten.

## 1. Base Information

```yaml
openapi: 3.1.0
info:
  title: Investigation Intelligence Platform API
  version: 1.0.0
servers:
  - url: /api/v1
```

Internal surface didokumentasikan terpisah di `/internal/v1` walaupun dapat dihasilkan dari codebase yang sama.

## 2. Suggested Tags

```text
Workspace
Case
Investigation
Subject
Resolution
Entity Registry
Knowledge
Evidence
Dataset
Analysis
Monitoring
Workflow
Execution
Sources
Intelligence
Notification
Search
SHADOW Queries
ECHO Queries
SPECTRA Queries
Internal Execution
Internal Evidence
Internal Analysis
```

## 3. Common Schemas

### DataClassification

```yaml
DataClassification:
  type: string
  enum: [PUBLIC, INTERNAL, SENSITIVE, RESTRICTED]
```

### ResourceRef

```yaml
ResourceRef:
  type: object
  required: [type, id, workspaceId]
  properties:
    type:
      type: string
    id:
      type: string
      format: uuid
    workspaceId:
      type: string
      format: uuid
    caseId:
      type: [string, "null"]
      format: uuid
```

### CursorPage

```yaml
CursorPage:
  type: object
  required: [hasMore]
  properties:
    nextCursor:
      type: [string, "null"]
    hasMore:
      type: boolean
```

### ErrorResponse

```yaml
ErrorResponse:
  type: object
  required: [error]
  properties:
    error:
      type: object
      required: [code, message, requestId]
      properties:
        code: { type: string }
        message: { type: string }
        requestId: { type: string }
        resource:
          $ref: '#/components/schemas/ResourceRef'
        details:
          type: object
          additionalProperties: true
```

### DeepLinkTarget

```yaml
DeepLinkTarget:
  type: object
  required: [product, workspaceId]
  properties:
    product:
      type: string
      enum: [SHADOW, ECHO, SPECTRA]
    workspaceId:
      type: string
      format: uuid
    caseId:
      type: [string, "null"]
      format: uuid
    investigationId:
      type: [string, "null"]
      format: uuid
    resource:
      $ref: '#/components/schemas/ResourceRef'
    view:
      type: [string, "null"]
    params:
      type: object
      additionalProperties:
        type: string
```

## 4. Case

### Schema

```yaml
Case:
  type: object
  required: [id, code, workspaceId, title, status, classification, revision]
  properties:
    id: { type: string, format: uuid }
    code: { type: string }
    workspaceId: { type: string, format: uuid }
    title: { type: string }
    description: { type: [string, "null"] }
    status:
      type: string
      enum: [DRAFT, ACTIVE, CLOSED, ARCHIVED]
    classification:
      $ref: '#/components/schemas/DataClassification'
    revision: { type: integer, minimum: 1 }
    createdAt: { type: string, format: date-time }
    updatedAt: { type: string, format: date-time }
```

### Paths

```text
POST   /cases
GET    /cases
GET    /cases/{caseId}
PATCH  /cases/{caseId}
POST   /cases/{caseId}/actions/close
POST   /cases/{caseId}/actions/reopen
POST   /cases/{caseId}/actions/archive
```

## 5. Investigation

```text
POST  /cases/{caseId}/investigations
GET   /cases/{caseId}/investigations
GET   /investigations/{investigationId}
PATCH /investigations/{investigationId}
```

Suggested lifecycle:
`ACTIVE | PAUSED | COMPLETED | ARCHIVED`

## 6. InvestigationSubject

```yaml
InvestigationSubject:
  type: object
  required: [id, caseId, subjectType, role, status, revision]
  properties:
    id: { type: string, format: uuid }
    caseId: { type: string, format: uuid }
    investigationId:
      type: [string, "null"]
      format: uuid
    subjectType:
      type: string
      enum: [PERSON, ORGANIZATION, SOCIAL_ACCOUNT, DOMAIN, UNKNOWN]
    role:
      type: string
      enum: [PRIMARY_TARGET, SECONDARY_TARGET, PERSON_OF_INTEREST, RELATED_PERSON, WITNESS, UNKNOWN]
    status:
      type: string
      enum: [UNRESOLVED, RESOLVING, RESOLVED, RESOLUTION_FAILED, ARCHIVED]
    entityRef:
      oneOf:
        - $ref: '#/components/schemas/ResourceRef'
        - type: 'null'
    seed:
      $ref: '#/components/schemas/SubjectSeed'
    revision: { type: integer }
```

### SubjectSeed

Field-level provenance wajib dipertahankan.

```yaml
SubjectSeed:
  type: object
  required: [fields]
  properties:
    fields:
      type: array
      items:
        $ref: '#/components/schemas/SubjectSeedField'

SubjectSeedField:
  type: object
  required: [name, value, origin]
  properties:
    name: { type: string }
    value: {}
    origin:
      type: string
      enum: [INVESTIGATOR_INPUT, SOURCE_RECORD, EVIDENCE, ANALYSIS_EXTRACTION, IMPORT]
    evidenceRef:
      $ref: '#/components/schemas/ResourceRef'
    sourceRecordRef:
      $ref: '#/components/schemas/ResourceRef'
    classification:
      $ref: '#/components/schemas/DataClassification'
```

### Paths

```text
POST  /cases/{caseId}/subjects
GET   /cases/{caseId}/subjects
GET   /subjects/{subjectId}
PATCH /subjects/{subjectId}
POST  /subjects/{subjectId}/actions/start-resolution
```

`start-resolution` biasanya `202 Accepted` dan mengembalikan `resolutionSessionId + runId`.

## 7. Resolution & Candidate

### ResolutionSession

```yaml
ResolutionSession:
  type: object
  properties:
    id: { type: string, format: uuid }
    subjectId: { type: string, format: uuid }
    status:
      type: string
      enum: [SEARCHING, NEEDS_REVIEW, RESOLVED, CLOSED]
    candidatesCount: { type: integer }
    selectedCandidateId: { type: [string, "null"] }
    resolutionDecisionId: { type: [string, "null"] }
```

### Candidate

```yaml
Candidate:
  type: object
  required: [id, type, status, revision]
  properties:
    id: { type: string, format: uuid }
    type:
      type: string
      enum: [PERSON, SOCIAL_ACCOUNT, ORGANIZATION, RELATIONSHIP]
    status:
      type: string
      enum: [PENDING_REVIEW, RESOLVED, REJECTED, UNCERTAIN]
    displayLabel: { type: string }
    sourceRunId: { type: [string, "null"], format: uuid }
    evidenceRefs:
      type: array
      items:
        $ref: '#/components/schemas/ResourceRef'
    revision: { type: integer }
```

### EntityMatch

```yaml
EntityMatch:
  type: object
  required: [entityRef, matchLevel]
  properties:
    entityRef:
      $ref: '#/components/schemas/ResourceRef'
    matchLevel:
      type: string
      enum: [LOW, MEDIUM, HIGH, VERY_HIGH]
    signals:
      type: array
      items:
        $ref: '#/components/schemas/MatchingSignal'
    conflicts:
      type: array
      items:
        $ref: '#/components/schemas/MatchingSignal'
    crossCaseContext:
      type: object
      properties:
        exists: { type: boolean }
        detailsVisible: { type: boolean }
```

### MatchingSignal

```yaml
MatchingSignal:
  type: object
  properties:
    type: { type: string }
    result: { type: string }
    strength:
      type: string
      enum: [WEAK, SUPPORTING, STRONG, CONTRADICTING]
    valueVisibility:
      type: string
      enum: [FULL, MASKED, MATCH_ONLY, HIDDEN]
```

### Paths

```text
GET  /resolutions/{resolutionId}
GET  /resolutions/{resolutionId}/candidates
GET  /resolutions/{resolutionId}/matches
GET  /candidates/{candidateId}
POST /candidates/{candidateId}/actions/resolve
```

Resolution request body:

```json
{
  "decision": "LINK_EXISTING",
  "entityId": "...",
  "reason": "Exact protected identifier and DOB match",
  "expectedRevision": 3
}
```

Allowed decisions:
`LINK_EXISTING | CREATE_NEW | UNCERTAIN | REJECT`

## 8. Entity Registry

```yaml
Entity:
  type: object
  required: [id, workspaceId, type, status, canonicalLabel, revision]
  properties:
    id: { type: string, format: uuid }
    workspaceId: { type: string, format: uuid }
    type:
      type: string
      enum:
        - PERSON
        - ORGANIZATION
        - SOCIAL_ACCOUNT
        - EMAIL_ADDRESS
        - PHONE_NUMBER
        - LOCATION
        - ADDRESS
        - DOMAIN
        - WEBSITE
        - IP_ADDRESS
        - VEHICLE
        - DEVICE
        - DOCUMENT
        - EVENT
    status:
      type: string
      enum: [ACTIVE, MERGED, ARCHIVED]
    canonicalLabel: { type: string }
    mergedInto:
      oneOf:
        - $ref: '#/components/schemas/ResourceRef'
        - type: 'null'
    revision: { type: integer }
```

### IdentifierView

```yaml
IdentifierView:
  type: object
  required: [id, type, visibility, classification]
  properties:
    id: { type: string }
    type: { type: string }
    visibility:
      type: string
      enum: [FULL, MASKED, MATCH_ONLY, HIDDEN]
    displayValue: { type: [string, "null"] }
    matchStatus: { type: [string, "null"] }
    classification:
      $ref: '#/components/schemas/DataClassification'
```

### Paths

```text
GET  /workspaces/{workspaceId}/entities
POST /workspaces/{workspaceId}/entities
GET  /entities/{entityId}
PATCH /entities/{entityId}
GET  /entities/{entityId}/identifiers
POST /entities/{entityId}/identifiers
POST /entities/{survivorEntityId}/actions/merge
POST /entity-merges/{mergeId}/actions/reverse
```

## 9. Knowledge

### Claim

```yaml
Claim:
  type: object
  properties:
    id: { type: string, format: uuid }
    scope:
      type: string
      enum: [CASE, WORKSPACE]
    caseId: { type: [string, "null"], format: uuid }
    subjectEntityId: { type: string, format: uuid }
    predicate: { type: string }
    object: {}
    status:
      type: string
      enum: [UNVERIFIED, SUPPORTED, CONFIRMED, CONFLICTED, REVOKED]
    evidenceRefs:
      type: array
      items:
        $ref: '#/components/schemas/ResourceRef'
    revision: { type: integer }
```

### Relationship

```yaml
Relationship:
  type: object
  properties:
    id: { type: string, format: uuid }
    scope:
      type: string
      enum: [CASE, WORKSPACE]
    caseId: { type: [string, "null"], format: uuid }
    sourceEntityId: { type: string, format: uuid }
    type: { type: string }
    targetEntityId: { type: string, format: uuid }
    status:
      type: string
      enum: [UNVERIFIED, SUPPORTED, CONFIRMED, CONFLICTED, REVOKED]
    validFrom: { type: [string, "null"], format: date-time }
    validUntil: { type: [string, "null"], format: date-time }
    evidenceRefs:
      type: array
      items:
        $ref: '#/components/schemas/ResourceRef'
    revision: { type: integer }
```

### RelationshipCandidate

A candidate endpoint dapat menunjuk ke Entity maupun unresolved Candidate.

```yaml
RelationshipEndpoint:
  oneOf:
    - type: object
      required: [kind, entityId]
      properties:
        kind: { const: ENTITY }
        entityId: { type: string, format: uuid }
    - type: object
      required: [kind, candidateId]
      properties:
        kind: { const: CANDIDATE }
        candidateId: { type: string, format: uuid }
```

### Paths

```text
POST /cases/{caseId}/claims
GET  /cases/{caseId}/claims
POST /cases/{caseId}/relationships
GET  /cases/{caseId}/relationships
GET  /cases/{caseId}/relationship-candidates

GET  /workspaces/{workspaceId}/knowledge/claims
GET  /workspaces/{workspaceId}/knowledge/relationships

POST /claims/{claimId}/actions/promote
POST /relationships/{relationshipId}/actions/promote
POST /relationships/{relationshipId}/actions/revoke

POST /relationship-candidates/{id}/actions/confirm
POST /relationship-candidates/{id}/actions/reject
POST /relationship-candidates/{id}/actions/investigate-target
```

## 10. Evidence

```yaml
Evidence:
  type: object
  properties:
    id: { type: string, format: uuid }
    caseId: { type: string, format: uuid }
    type: { type: string }
    classification:
      $ref: '#/components/schemas/DataClassification'
    observedAt: { type: string, format: date-time }
    sourceRecordRef:
      $ref: '#/components/schemas/ResourceRef'
    entityRefs:
      type: array
      items:
        $ref: '#/components/schemas/ResourceRef'
    latestVersion: { type: integer }
```

```text
GET /evidence/{evidenceId}
GET /cases/{caseId}/evidence
GET /evidence/{evidenceId}/lineage
GET /evidence/{evidenceId}/raw
```

`/raw` policy-controlled.

## 11. Dataset

```yaml
Dataset:
  type: object
  properties:
    id: { type: string, format: uuid }
    caseId: { type: string, format: uuid }
    kind:
      type: string
      enum: [SNAPSHOT, VIEW]
    type: { type: string }
    status:
      type: string
      enum: [BUILDING, READY, FAILED]
    itemCount: { type: integer }
    completeness:
      $ref: '#/components/schemas/DatasetCompleteness'
    createdByRunId: { type: [string, "null"], format: uuid }
```

```yaml
DatasetCompleteness:
  type: object
  properties:
    status:
      type: string
      enum: [COMPLETE, PARTIAL, UNKNOWN]
    reasons:
      type: array
      items: { type: string }
```

```text
GET  /datasets/{datasetId}
GET  /cases/{caseId}/datasets
POST /cases/{caseId}/dataset-views
POST /dataset-views/{viewId}/actions/snapshot
```

## 12. Analysis

```text
GET  /analysis-definitions
POST /datasets/{datasetId}/analyses
GET  /analyses/{analysisId}
GET  /analyses/{analysisId}/results
```

`POST /datasets/{datasetId}/analyses` → `202`.

Analysis result lineage harus mencakup:
- immutable input DatasetSnapshot;
- AnalysisDefinition/version;
- model name/version;
- configuration;
- Run.

## 13. Monitoring & Alert

```yaml
MonitoringTarget:
  type: object
  properties:
    id: { type: string, format: uuid }
    caseId: { type: string, format: uuid }
    entityId: { type: [string, "null"], format: uuid }
    type: { type: string }
    status:
      type: string
      enum: [ACTIVE, PAUSED, STOPPED]
    configuration:
      type: object
```

```text
POST /cases/{caseId}/monitoring-targets
GET  /cases/{caseId}/monitoring-targets
GET  /monitoring-targets/{id}
POST /monitoring-targets/{id}/actions/pause
POST /monitoring-targets/{id}/actions/resume
POST /monitoring-targets/{id}/actions/stop
POST /monitoring-targets/{id}/schedules
POST /monitoring-targets/{id}/rules
```

Alert:

```text
GET  /cases/{caseId}/alerts
GET  /alerts/{alertId}
POST /alerts/{id}/actions/acknowledge
POST /alerts/{id}/actions/investigate
POST /alerts/{id}/actions/resolve
POST /alerts/{id}/actions/dismiss
```

Alert bukan Finding.

## 14. Workflow & Run

```text
GET    /node-definitions
GET    /node-definitions/{key}/versions/{version}
GET    /investigations/{id}/workflow
POST   /investigations/{id}/nodes
PATCH  /nodes/{nodeInstanceId}
DELETE /nodes/{nodeInstanceId}
POST   /nodes/{nodeInstanceId}/input-bindings
POST   /investigations/{id}/workflow-edges
POST   /nodes/{nodeInstanceId}/actions/run

GET  /runs/{runId}
GET  /cases/{caseId}/runs
POST /runs/{runId}/actions/cancel
POST /runs/{runId}/actions/retry
```

Long-running Run response:

```json
{
  "operation": {
    "type": "RUN",
    "id": "...",
    "status": "QUEUED"
  }
}
```

Run progress:

```yaml
RunProgress:
  type: object
  properties:
    stage: { type: string }
    processed: { type: integer }
    produced: { type: integer }
    total: { type: [integer, "null"] }
```

No fake percentage if `total` unknown.

## 15. Experience Query Skeleton

### SHADOW

```text
GET /shadow/cases/{caseId}/overview
GET /shadow/cases/{caseId}/profile-inbox
GET /shadow/profiles
GET /shadow/profiles/{entityId}
GET /shadow/cases/{caseId}/intelligence-feed
GET /shadow/cases/{caseId}/timeline
```

### ECHO

```text
GET /echo/cases/{caseId}/graph
GET /echo/entities/{entityId}/context
GET /echo/cases/{caseId}/activity-correlations
GET /echo/cases/{caseId}/knowledge-conflicts
GET /echo/cases/{caseId}/resolution-queue
```

### SPECTRA

```text
GET /spectra/cases/{caseId}/overview
GET /spectra/cases/{caseId}/entities/{entityId}
GET /spectra/cases/{caseId}/activity
GET /spectra/cases/{caseId}/news
GET /spectra/cases/{caseId}/sentiment
GET /spectra/cases/{caseId}/engagement
GET /spectra/cases/{caseId}/interactions
GET /spectra/cases/{caseId}/coordination
GET /spectra/cases/{caseId}/alerts
```

## 16. Internal Worker Skeleton

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

## 17. Realtime

```text
GET /api/v1/realtime/events
```

Minimal event contract:

```yaml
RealtimeEvent:
  type: object
  required: [id, type, version, timestamp]
  properties:
    id: { type: string }
    type: { type: string }
    version: { type: integer }
    timestamp: { type: string, format: date-time }
    caseId: { type: [string, "null"], format: uuid }
    resource:
      $ref: '#/components/schemas/ResourceRef'
    payload:
      type: object
      additionalProperties: true
```

## 18. Search

```text
POST /search
```

Search contract harus platform-owned, governance-aware, dan tidak menerima arbitrary Elasticsearch DSL.

## 19. Remaining Schema Work

Belum final dan akan didefinisikan per implementation slice:
- typed `Claim.object` representation;
- ontology schema details;
- SubjectSeed typed value registry;
- polymorphic AnalysisResult schema;
- Dataset View filter grammar;
- MonitoringRule condition DSL;
- advanced Search filters;
- Export;
- Governance admin surfaces.

Bagian-bagian tersebut tidak mengubah architecture utama.
