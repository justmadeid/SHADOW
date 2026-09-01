# Development Plan & Implementation Phasing v1

**Status:** Recommended implementation sequence after architecture baseline.  
**Goal:** Membangun platform berdasarkan dependency architecture, bukan urutan halaman UI.

## 1. Strategy

Gunakan pendekatan **vertical architecture slices dengan foundation-first dependencies**.

Tidak disarankan:
- membuat semua database tables dulu tanpa working flow;
- membuat seluruh UI SHADOW terlebih dahulu lalu backend menyusul;
- membuat SPECTRA/ECHO sebagai silo;
- membuat connector langsung sebelum Run/Evidence/provenance siap;
- membuat ML analysis sebelum DatasetSnapshot/reproducibility tersedia.

Recommended implementation principle:

> Setiap phase harus menghasilkan satu capability end-to-end yang dapat diuji, sambil menambah foundation yang dapat digunakan phase berikutnya.

---

## 2. MVP North-Star Flow

Flow yang harus bekerja paling awal:

```text
Create Case
→ Add Person Subject
→ Person Lookup via existing Hono Resident API
→ Candidate Review
→ Link Existing / Create Entity
→ Resolved Target Profile
→ Create Case Relationship/Claim
→ Collect/ingest evidence with provenance
→ Run basic analysis
→ Create Hypothesis
→ Create Finding
→ Review/Approve Finding
```

Kemudian diperluas ke:

```text
Monitor Social/News
→ New Evidence
→ Analysis
→ Candidate B
→ Profile Inbox
→ Resolve B
→ ECHO Relationship Candidate
→ Case Knowledge
→ Finding
```

---

# Phase 0 — Repository & Engineering Baseline

## Objectives

Membuat monorepo dapat dibangun, dites, dan diobservasi sebelum business complexity masuk.

## Deliverables

```text
apps/
├── platform-web
├── platform-api
├── connector-worker
├── intelligence-worker
└── indexing-worker

packages/
├── contracts
├── api-client
├── ui
├── canvas-kit
├── auth
├── connector-sdk
├── database
├── observability
├── config
└── testing
```

Implement:
- workspace package manager/build orchestration;
- TypeScript config/lint/format;
- NestJS platform-api bootstrap;
- Next.js platform-web shell;
- PostgreSQL local environment;
- Redis/BullMQ local environment;
- S3-compatible local object storage;
- Elasticsearch Investigation Search local environment;
- OpenTelemetry base instrumentation;
- structured logging with PII-safe defaults;
- health/readiness endpoints;
- test framework;
- dependency-boundary lint rules.

## Architecture Gates

Phase selesai bila:
- product boundary imports dapat divalidasi CI;
- backend module boundary imports dapat divalidasi CI;
- all deployables boot locally;
- traceId/requestId propagated API → worker skeleton;
- secrets tidak berada di repo.

---

# Phase 1 — Auth, Workspace, Case, Governance Foundation

## Objectives

Membangun protected Case shell sebagai root context seluruh capability.

## Backend

Implement modules:
- workspace;
- case;
- investigation;
- governance minimal;
- audit foundation;
- notification foundation.

Implement:
- authenticated principal/request context;
- workspace membership;
- Case CRUD/lifecycle;
- Investigation CRUD;
- classifications;
- basic RBAC/case membership;
- PolicyEnforcer abstraction;
- critical AuditEvent persistence;
- `ResourceRef`, `DeepLinkTarget`, standard error contract;
- UUIDv7 IDs;
- revision/ETag convention;
- idempotency infrastructure.

## Frontend

Platform shell:
- auth;
- workspace context;
- case switcher;
- SHADOW/ECHO/SPECTRA navigation;
- case create/list/detail;
- global notification placeholder;
- shared API client.

## Acceptance

User dapat:
1. login;
2. select Workspace;
3. create Case;
4. create Investigation;
5. see classification and membership;
6. audit records exist for critical Case changes.

---

# Phase 2 — Subject + Entity Registry + Resolution Core

## Objectives

Menyelesaikan reusable identity model sebelum connector complexity meningkat.

## Backend

Implement:
- subject;
- entity-registry;
- resolution;
- minimal knowledge foundations required by identity attribution.

Core models:
- InvestigationSubject;
- SubjectSeed with field provenance;
- Entity;
- Identifier;
- Alias;
- Candidate;
- ResolutionSession;
- MatchingSignal;
- ResolutionDecision.

Implement APIs:
- Subject CRUD;
- search existing workspace profiles/entities;
- candidate/matches;
- `LINK_EXISTING`;
- `CREATE_NEW`;
- `UNCERTAIN`;
- `REJECT`;
- TargetProfileView read model;
- cross-case existence disclosure policy;
- identifier masking (`FULL/MASKED/MATCH_ONLY/HIDDEN`).

## Critical Transaction

`Candidate resolution + Entity create/link + Subject resolved` harus atomic.

## Frontend — SHADOW

Implement:
- Subject list;
- Add Target;
- Search Existing Profile;
- unresolved/resolved subject states;
- candidate comparison UI;
- matching signals/conflicts;
- Target Profile base view.

## Acceptance

Satu Entity dapat digunakan oleh dua Case tanpa duplicate Person, dan user tanpa permission tidak dapat melihat restricted cross-case context.

---

# Phase 3 — Workflow + Execution Runtime Foundation

## Objectives

Membangun long-running execution backbone sebelum real connector dipasang.

## Backend

Implement modules:
- workflow;
- execution;
- source-registry.

Models:
- NodeDefinition;
- NodeInstance;
- InputBinding;
- Run;
- ExecutionAttempt;
- ExecutionPlan;
- ExecutionOutbox;
- Checkpoint;
- progress.

Implement:
- transactional Run + Outbox;
- BullMQ dispatch;
- service-auth internal API;
- attempt lease/heartbeat;
- infrastructure retry;
- business retry;
- cancellation;
- SSE run progress;
- standard error taxonomy;
- idempotent worker completion.

## Worker

Connector worker runtime skeleton:
- queue consumer;
- execution plan fetch;
- heartbeat;
- progress;
- retry/backoff;
- cancellation;
- no direct DB access.

## Acceptance

Dummy connector Node dapat:
1. create Run;
2. dispatch via Outbox/BullMQ;
3. execute in worker;
4. update progress via internal API;
5. complete;
6. stream status via SSE;
7. retry safely without duplicate side effects.

---

# Phase 4 — Resident Data Connector + Evidence Ingestion

## Objectives

Membuat Person Lookup pertama benar-benar end-to-end menggunakan existing Hono service.

## Connector

Implement `resident-data` connector package:
- semantic PersonLookupInput;
- Hono client;
- schema validation;
- source error mapping;
- restricted execution profile;
- credential reference;
- rate/timeout/retry policy;
- result envelope.

Platform **tidak** query Resident Elasticsearch langsung.

## Evidence

Implement:
- DataSourceDefinition Resident Data;
- ConnectorDefinition Resident API;
- SourceRecord;
- Observation;
- Evidence ingestion internal endpoint;
- raw persistence policy;
- idempotent batch ingestion;
- provenance lineage.

Restricted source rules:
- no raw NIK in logs;
- no secret in Run/broker payload;
- reasonForAccess mandatory;
- restricted worker queue/profile;
- source access audit.

## Person Lookup Flow

```text
Subject
→ Start Resolution
→ Person Lookup Node/Run
→ Restricted Connector Worker
→ Hono
→ SourceRecord/PersonObservation
→ Candidate
→ Candidate Review
→ Entity
→ Subject Resolved
```

## Acceptance

Reference flow harus dapat didemonstrasikan dan lineage dari Candidate kembali ke Run/Connector/Source dapat dilihat.

---

# Phase 5 — Knowledge + ECHO Minimum Viable Graph

## Objectives

Memungkinkan investigator menyimpan dan mengkurasi Case Knowledge tanpa menjadikan graph sebagai source of truth.

## Backend

Implement Knowledge:
- Claim;
- Relationship;
- KnowledgeScope;
- Case Knowledge;
- basic Workspace Knowledge;
- KnowledgePromotion;
- Revision/Revocation;
- RelationshipCandidate;
- controlled relationship ontology.

Implement merge/reverse-merge minimum viable behavior bila belum selesai Phase 2.

## Frontend — ECHO

Implement:
- Entity graph;
- layer distinction;
- entity inspector;
- Case Relationship create/review;
- RelationshipCandidate review;
- evidence references;
- Workspace vs Case Knowledge visual distinction;
- Open in SHADOW.

## Acceptance

Graph tidak menyimpan duplicate Person data; changing graph layout tidak mengubah canonical domain. Case Relationship dapat dipromosikan secara explicit dan auditable.

---

# Phase 6 — Dataset + Analysis Foundation

## Objectives

Menyiapkan reproducible analytics sebelum SPECTRA intelligence berkembang.

## Backend

Implement:
- DatasetSnapshot;
- DatasetView;
- membership;
- completeness;
- attribution context;
- AnalysisDefinition;
- AnalysisResult;
- AnalysisArtifactRef;
- analysis execution through shared Run runtime.

## Intelligence Worker

Initial capabilities:
- normalization jobs;
- simple entity extraction;
- basic sentiment pipeline or deterministic placeholder;
- relationship candidate generation.

Python worker dapat ditambahkan hanya bila capability nyata membutuhkan Python; jangan dibuat hanya untuk anticipation.

## Acceptance

Analysis result harus reproducible:
- exact DatasetSnapshot;
- model/version;
- config;
- Run;
- evidence lineage.

Analysis tidak memodifikasi Evidence atau auto-create Knowledge.

---

# Phase 7 — SPECTRA Monitoring MVP

## Objectives

Membangun recurring social/news intelligence loop dengan source yang memang authorized dan available.

## Backend

Implement Monitoring:
- MonitoringTarget;
- Watchlist basic;
- schedule;
- MonitoringRule;
- baseline basic;
- Alert;
- AlertGroup;
- Case Capability Summary;
- IntelligenceHighlight integration.

Monitoring memicu shared Workflow/Execution, bukan connector langsung.

## Connector Scope

Prioritaskan source yang legal/authorized dan integration contract-nya jelas.

MVP dapat mulai dari:
- News connector;
- satu social source yang tersedia;
- existing internal APIs.

Jangan bergantung pada connector yang belum ada authorized access-nya.

## Frontend — SPECTRA

Implement:
- monitoring target list;
- activity/news feed;
- basic timeline;
- sentiment summary;
- engagement summary;
- alerts;
- deep-link Explore in ECHO;
- Investigate in SHADOW.

## Acceptance

Scheduled monitoring → Evidence → Dataset → Analysis → Alert dapat berjalan tanpa manual intervention dan tetap provenance-aware.

---

# Phase 8 — Profile Inbox + Recursive Discovery Loop

## Objectives

Menyelesaikan signature investigation loop platform.

Flow:

```text
Known Target A
→ Monitoring
→ News/Social Evidence
→ Entity Extraction
→ Candidate B
→ RelationshipCandidate A ? B
→ Profile Inbox
→ Investigate B
→ SubjectSeed with provenance
→ Entity Registry search
→ Person Lookup if needed
→ PERSON-B
→ ECHO rebind candidate
→ Human Review
→ Case Knowledge
```

## Frontend

SHADOW:
- Profile Inbox;
- candidate source/evidence context;
- Investigate/Link Existing/Ignore.

ECHO:
- unresolved candidate node;
- rebind to canonical Entity after resolution.

SPECTRA:
- candidate extraction surfaces.

## Acceptance

B dapat ditemukan dari source analysis, investigated in SHADOW, resolved as reusable Entity, lalu relationship candidate di ECHO berubah tanpa data copy.

---

# Phase 9 — Hypothesis + Finding Reasoning Layer

## Objectives

Mengubah collected intelligence menjadi defensible investigative conclusion.

## Backend

Implement Intelligence module:
- Hypothesis;
- HypothesisResourceLink;
- assessment history;
- Finding;
- FindingResourceLink;
- FindingReview;
- FindingRevision/Supersede/Retract;
- Case Intelligence Feed;
- Case Timeline.

## Frontend

SHADOW:
- Findings workspace;
- review workflow;
- confidence/rationale;
- support/contradiction display.

ECHO:
- Hypothesis mode;
- evidence support/contradict map;
- graph-assisted reasoning.

SPECTRA:
- Create Hypothesis from Analysis;
- Create Draft Finding from Alert/Analysis.

## Acceptance

Approved Finding dapat menjawab:
- who authored;
- who reviewed;
- which evidence supports;
- which evidence contradicts;
- which analysis/model/version;
- which resource revision;
- when approved.

---

# Phase 10 — Search Projection + Indexing Worker

## Objectives

Membuat investigation search scalable tanpa menjadikan Elasticsearch canonical store.

## Implement

- indexing outbox/events;
- indexing worker;
- Investigation Elasticsearch mappings;
- Entity/Evidence/Finding projections;
- governance-aware search;
- rebuild tooling;
- projection revision/freshness metadata.

Resident Elasticsearch tetap terisolasi di belakang Hono.

## Acceptance

Search index dapat dihapus dan dibangun ulang dari canonical/evented sources tanpa data loss.

---

# Phase 11 — Hardening & Operational Readiness

## Security/Governance

- restricted source access matrix;
- field masking coverage;
- export policy;
- audit viewer access;
- cross-case confidentiality tests;
- retention state machine;
- secure object storage access;
- service principal rotation;
- worker network isolation.

## Reliability

- failure injection worker;
- outbox replay;
- connector rate-limit testing;
- idempotency testing;
- partial collection/cancellation;
- stale projection behavior;
- backup/restore;
- queue recovery.

## Observability

Dashboards/alerts for:
- API latency/error;
- queue depth;
- outbox lag;
- run duration;
- worker failures;
- connector health;
- source rate limits;
- Evidence throughput;
- analysis duration;
- monitoring schedule lag.

## Performance

Benchmark scenarios:
- Case overview;
- large Evidence pagination;
- ECHO graph around high-degree entity;
- SPECTRA activity filter;
- search;
- high-volume connector batch ingestion.

---

# 3. Recommended Implementation Priority

If team capacity is limited, prioritize:

```text
P0
Foundation + Case + Subject + Resolution + Entity

P1
Execution Runtime + Resident Connector + Evidence

P2
Knowledge + ECHO Basic

P3
Dataset + Analysis + Monitoring + SPECTRA Basic

P4
Recursive Discovery + Hypothesis + Finding

P5
Search/Indexing + hardening + advanced analysis
```

This ordering produces useful investigator value early without sacrificing architecture.

---

# 4. MVP Definition

A defensible MVP should support:

1. authenticated Workspace and Case;
2. Investigation and Subjects;
3. existing Target Profile reuse;
4. Resident Person Lookup via Hono;
5. Candidate review and identity resolution;
6. Workspace Entity Registry;
7. Case Claims/Relationships;
8. Evidence lineage;
9. generic Workflow/Run execution;
10. at least one recurring Monitoring flow;
11. immutable DatasetSnapshot;
12. at least one Analysis capability;
13. Relationship/Entity Candidate workflow;
14. ECHO basic graph;
15. SPECTRA basic monitoring/activity;
16. Profile Inbox recursive discovery;
17. Hypothesis;
18. Finding with approval;
19. Governance/Audit baseline;
20. SSE Run/Alert/Notification updates.

Advanced ML, graph database, collaborative WebSocket canvas, multi-channel notification, and complex reports are not required for first MVP.

---

# 5. Testing Pyramid by Domain

## Unit
- aggregates/invariants;
- matching signal policies;
- relationship ontology validation;
- rule evaluation;
- state transitions.

## Module Integration
- repository + transaction;
- public facade;
- governance policies;
- audit creation;
- outbox.

## Contract Tests
- OpenAPI request/response;
- connector SDK;
- internal worker APIs;
- generated api-client.

## End-to-End Reference Flows
At minimum automate:
1. New Target Person Lookup;
2. Existing Target reuse;
3. Connector retry/resume;
4. Relationship candidate → B resolution;
5. Monitoring → Alert;
6. Knowledge promotion/revocation;
7. Finding approval/supersede.

## Security Tests
- unauthorized cross-case lookup;
- masked identifiers;
- restricted raw evidence;
- worker internal endpoint isolation;
- audit integrity.

---

# 6. Architecture Definition of Done

Feature tidak dianggap selesai jika hanya “UI berfungsi”.

Setiap domain feature harus memenuhi bila relevan:
- ownership jelas;
- provenance tersedia;
- governance check;
- audit event;
- idempotency;
- optimistic concurrency;
- API schema/OpenAPI;
- generated client update;
- realtime event minimal bila async;
- module boundary test;
- integration tests;
- no PII logs;
- documentation/ADR update jika architecture berubah.

---

# 7. What Not To Build Early

Hindari premature complexity:
- Neo4j as canonical store;
- Temporal sebelum orchestration membutuhkan;
- service-per-domain microservices;
- WebSocket collaboration sebelum ECHO collaboration nyata;
- Python worker tanpa actual ML requirement;
- one connector service per source;
- shared cross-case collection dedupe sebelum governance matang;
- generic rules DSL terlalu powerful;
- universal `Operation` abstraction untuk semua command;
- automatic AI-to-Knowledge promotion.

---

# 8. First Engineering Epic Recommendation

Jika development mulai setelah docs/API review, epic pertama sebaiknya:

> **Case & Identity Foundation**

Scope:
- monorepo baseline;
- auth/request context;
- Workspace/Case/Investigation;
- Subject/SubjectSeed;
- Entity Registry;
- Resolution interfaces;
- Target Profile read model skeleton;
- Governance/Audit baseline;
- OpenAPI/client generation pipeline.

Epic kedua:

> **Execution & Resident Lookup**

Scope:
- Workflow/Run;
- Outbox/BullMQ;
- connector worker;
- Source Registry;
- Resident connector;
- Evidence ingestion;
- Candidate generation;
- SHADOW resolution flow.

Dengan dua epic tersebut, platform sudah memiliki foundation yang benar-benar menunjukkan value dan memvalidasi hampir seluruh architecture utama.
