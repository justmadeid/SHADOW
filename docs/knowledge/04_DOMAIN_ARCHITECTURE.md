# Domain Architecture

## 1. Domain Map

```text
Workspace
Case
Investigation
Subject

Workflow
Execution
Source Registry

Entity Registry
Resolution
Knowledge

Evidence
Dataset
Analysis
Monitoring

Intelligence

Governance
Audit
Notification
```

SHADOW/ECHO/SPECTRA **bukan** backend domain modules.

## 2. Ownership

### Workspace
- Workspace
- WorkspaceMember
- WorkspaceSettings

### Case
- Case
- CaseStatus
- CaseMember
- CaseResourceReference

### Investigation
- Investigation
- Objective
- Branch
- InvestigationStatus

### Subject
- InvestigationSubject
- SubjectSeed
- SubjectRole
- SubjectStatus

### Workflow
- NodeDefinition
- NodeInstance
- InputBinding
- WorkflowEdge
- WorkflowConfiguration

### Execution
- Run
- ExecutionAttempt
- ExecutionPlan
- RunProgress
- RunCheckpoint
- ExecutionOutbox
- Retry lineage
- Cancellation

### Source Registry
- DataSourceDefinition
- ConnectorDefinition
- Capability
- SourcePolicy
- SourceTrust
- ExecutionProfile

### Entity Registry
- Entity
- Identifier
- Alias
- CanonicalLabel
- EntityStatus
- Merge/Split History

### Resolution
- Candidate
- ResolutionSession
- MatchingSignal
- ConflictSignal
- ResolutionDecision

### Knowledge
- Claim
- Relationship
- KnowledgeScope
- KnowledgePromotion
- KnowledgeRevision
- KnowledgeConflict

### Evidence
- SourceRecord
- Observation
- Evidence
- EvidenceVersion
- EvidenceRelation
- EngagementSnapshot

### Dataset
- Dataset
- DatasetSnapshot
- DatasetView
- DatasetMembership
- Completeness
- AttributionContext

### Analysis
- AnalysisDefinition
- AnalysisRun metadata
- AnalysisResult
- AnalysisArtifactRef
- ModelMetadata

### Monitoring
- MonitoringTarget
- Watchlist
- MonitoringRule
- Schedule
- Alert
- AlertGroup
- Narrative

### Intelligence
- Hypothesis
- Finding
- AnalystDecision
- AnalystNote
- IntelligenceHighlight
- Case Intelligence Feed
- Case Timeline

### Governance
- Role
- Permission
- CaseAccess
- ConnectorAccess
- Classification
- FieldPolicy
- ReasonForAccess
- ExportPolicy
- RetentionPolicy

### Audit
- AuditEvent
- AuditAction
- AuditActor

### Notification
- Notification
- NotificationPreference
- Delivery state

## 3. Module Boundary Pattern

```text
module/
├── domain/
├── application/
├── infrastructure/
├── presentation/ (jika diperlukan)
└── index.ts
```

`index.ts` adalah public boundary. Module lain tidak boleh import repository, persistence model, atau table internal.

## 4. Cross-Module Interaction

Prefer:
- public facade/application API;
- typed IDs / ResourceRef;
- domain events;
- orchestration layer;
- transactional outbox untuk cross-process.

Hindari:
- cross-module SQL;
- import repository module lain;
- giant CommonModule;
- direct mutation table milik domain lain.

## 5. Sync vs Event

Synchronous facade untuk immediate answer:
```text
Monitoring → EntityRegistryFacade.getEntityRef()
```

Domain event untuk side effects:
```text
EntityMerged
→ Search projection
→ Notification
→ Monitoring reaction
```

Job transport/outbox untuk work yang cross-process, long-running, retryable, atau external-effect.

## 6. Presentation / Read Models

Complex reads boleh experience-oriented:
- SHADOW Case Overview;
- ECHO Graph View;
- SPECTRA Account Dashboard.

Read model dapat menggabungkan beberapa domain tetapi tidak menjadi source of truth.

## 7. Worker Boundary

Worker menggunakan internal service API untuk:
- execution plan;
- attempts/progress/checkpoint;
- evidence ingestion;
- analysis result registration.

Worker tidak direct write business database.

## 8. Transaction Consistency

Critical identity transition dapat atomic:
```text
ResolutionDecision
+ Entity create/link
+ Subject resolve
```

Collection/analysis pipeline naturally async dan tidak perlu satu giant transaction.
