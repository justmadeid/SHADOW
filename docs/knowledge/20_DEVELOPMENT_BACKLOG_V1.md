# Development Backlog v1

**Purpose:** Detailed implementation backlog derived from the locked architecture. Tasks are dependency-oriented, not page-oriented.

## How to use

- Treat task IDs as stable references in commits, PRs, tickets, ADRs, and AI-agent prompts.
- A task is not complete until its acceptance criteria, tests, security checks, and architecture gates pass.
- Do not start a task when a listed hard dependency is incomplete unless an ADR explicitly changes the dependency.
- Prefer vertical slices: database/domain/API/worker/UI/test should meet at a usable capability.
- Any architecture deviation must update the relevant ADR/knowledge document before or with the code change.

## Milestones

| Milestone | Result |
|---|---|
| **M0 Engineering Ready** | Semua deployable dapat boot, dites, diobservasi, dan mengikuti boundary sebelum business complexity masuk. |
| **M1 Protected Case Shell** | Membangun protected Case context dan authorization foundation yang akan dipakai semua capability. |
| **M2 Reusable Identity Core** | Membuat identity pipeline aman: unknown subject → candidate → human resolution → reusable Entity. |
| **M3 Reliable Async Runtime** | Membangun generic execution plane sebelum connector production dipasang. |
| **M4 Person Lookup End-to-End** | Menghasilkan vertical slice pertama dari SHADOW ke Hono Resident API hingga candidate dengan provenance. |
| **M5 Curated Knowledge Graph** | Membangun Case/Workspace Knowledge dan ECHO graph tanpa menjadikan graph database sebagai source of truth. |
| **M6 Reproducible Analysis** | Menjamin analysis reproducible dan tidak menulis langsung ke Evidence/Knowledge. |
| **M7 Continuous Intelligence** | Membangun monitoring loop yang menggunakan execution/evidence/analysis foundation yang sama. |
| **M8 Investigation Intelligence Loop** | Membuat hasil SPECTRA/ECHO dapat menjadi subject baru tanpa kehilangan provenance atau membuat canonical truth otomatis. |
| **M9 Defensible Case Intelligence** | Mengubah evidence/analysis menjadi reasoning dan analyst-approved finding yang defensible. |
| **M10 Fast Investigation Search** | Menyediakan search/read performance tanpa menjadikan Elasticsearch canonical store. |
| **M11 Production Candidate** | Membuktikan security, reliability, recoverability, performance, operations dan release safety. |

## Cross-cutting Definition of Ready

A task is ready when:
1. Domain owner and source-of-truth are known.
2. API/event/resource contracts are known or explicitly part of the task.
3. Data classification is known.
4. Security boundary and authorization action are identified.
5. Dependencies are complete or mocked by a stable contract.
6. Acceptance criteria are testable.

## Cross-cutting Definition of Done

A task is done only when:
- implementation follows module/product boundaries;
- automated tests cover happy path + critical failure path;
- authorization is enforced server-side;
- sensitive data is not leaked to logs/events/search projections;
- idempotency/concurrency behavior is defined for mutations;
- telemetry exists for operationally relevant work;
- API/OpenAPI/contracts are updated;
- documentation/ADR is updated if semantics changed;
- no unresolved Critical/High security or architecture gate violation exists.


# P0 — Repository & Engineering Baseline

**Milestone:** M0 Engineering Ready

**Goal:** Semua deployable dapat boot, dites, diobservasi, dan mengikuti boundary sebelum business complexity masuk.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P0-001` | **Scaffold monorepo and deployables** — Create apps/platform-web, platform-api, connector-worker, intelligence-worker, indexing-worker and shared packages. | platform | — | All apps boot locally; workspace scripts build/test/lint all packages. |
| `P0-002` | **Enforce frontend product boundaries** — Add lint/dependency rules preventing SHADOW/ECHO/SPECTRA internal cross-imports. | frontend | P0-001 | CI fails on forbidden product import. |
| `P0-003` | **Enforce backend module boundaries** — Prevent modules from importing another module's infrastructure/repository internals. | backend | P0-001 | Only public module entrypoints/facades can be imported cross-module. |
| `P0-004` | **Environment and configuration contract** — Typed config validation, environment separation, safe defaults, startup failure on invalid required config. | platform | P0-001 | No silent fallback for security-critical config; secrets absent from repository. |
| `P0-005` | **Local infrastructure stack** — Provide reproducible local PostgreSQL, Redis, S3-compatible object store, Investigation Elasticsearch and telemetry dependencies. | platform | P0-001 | One documented command boots local dependencies and health checks pass. |
| `P0-006` | **Database transaction foundation** — Create DB connection, transaction context, migration conventions and module-owned persistence pattern. | backend | P0-004,P0-005 | Transactions can span public module operations without exposing raw DB client cross-module. |
| `P0-007` | **Transactional outbox foundation** — Implement outbox persistence primitive and dispatcher contract. | backend | P0-006 | Business row + outbox row commit atomically; dispatcher is retry-safe. |
| `P0-008` | **Request context foundation** — Propagate requestId, traceId, user/workspace/case context and optional reasonForAccess. | backend | P0-004 | Context available to application layer without global mutable state. |
| `P0-009` | **Structured PII-safe logging** — Central logger, redaction rules, correlation IDs and prohibited-field tests. | platform | P0-008 | NIK/phone/email/raw payload are redacted by default; tests prove it. |
| `P0-010` | **OpenTelemetry baseline** — Trace API, queue dispatch and worker skeleton; add core metrics. | platform | P0-008 | Trace correlation works API → outbox/queue → worker. |
| `P0-011` | **API primitives** — Implement shared ErrorResponse, ResourceRef, pagination, revision/ETag and Idempotency-Key helpers. | backend | P0-001 | Contract tests cover error, cursor, conflict and idempotency semantics. |
| `P0-012` | **Testing foundation** — Unit, module integration, contract and E2E test harnesses with isolated test data. | quality | P0-001,P0-005 | CI runs deterministic tests without depending on developer machine state. |
| `P0-013` | **CI quality pipeline** — Lint, typecheck, unit/integration tests, dependency-boundary checks, migration validation and build. | devops | P0-002,P0-003,P0-012 | No merge when required quality gate fails. |
| `P0-014` | **Health/readiness endpoints** — Define liveness/readiness for API and worker processes. | platform | P0-005 | Readiness reflects critical internal dependencies but not optional external-source health. |
| `P0-015` | **Developer and AI-agent operating rules** — Add AGENTS.md, engineering standards, Definition of Done and task template. | docs | P0-001 | New engineer/agent has an explicit reading order and forbidden-shortcut list. |

### Phase exit gate

Phase `P0` exits only when all tasks required for **M0 Engineering Ready** pass their automated tests and applicable Architecture Gates.

# P1 — Auth, Workspace, Case & Governance Foundation

**Milestone:** M1 Protected Case Shell

**Goal:** Membangun protected Case context dan authorization foundation yang akan dipakai semua capability.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P1-001` | **OIDC authentication integration** — Validate access tokens and service identities; do not embed domain authorization in auth middleware. | backend | P0-008 | 401/identity behavior covered by integration tests. |
| `P1-002` | **Workspace domain** — Workspace, membership and basic settings with UUIDv7 IDs and revision. | backend | P1-001,P0-006 | Workspace access isolated; membership changes auditable. |
| `P1-003` | **Case domain** — Case aggregate, code, classification, status lifecycle and optimistic concurrency. | backend | P1-002 | Create/read/update/close/reopen Case contracts pass. |
| `P1-004` | **Investigation domain** — Investigation branches/objectives/status under Case. | backend | P1-003 | Investigation cannot cross workspace/case boundary. |
| `P1-005` | **Governance permission model** — Role/permission/action/resource/context policy model and PolicyEnforcer facade. | security | P1-001,P1-002 | Authorization decisions are centralized and unit tested. |
| `P1-006` | **Case membership policy** — Case-scoped membership and access checks, including confidentiality-safe 404 behavior. | security | P1-003,P1-005 | IDOR/cross-case tests prove isolation. |
| `P1-007` | **Data classification primitive** — PUBLIC/INTERNAL/SENSITIVE/RESTRICTED handling metadata and policy hooks. | security | P1-005 | Classification can influence display/export/source access without app-name branching. |
| `P1-008` | **Critical audit baseline** — Append-only audit events/intents for case access changes and sensitive operations. | backend | P0-007,P1-005 | Business action cannot commit while required durable audit intent is lost. |
| `P1-009` | **Platform shell auth/workspace/case context** — Global shell contexts, navigation, guarded routes and permission-aware UI. | frontend | P1-002,P1-003,P1-006 | SHADOW/ECHO/SPECTRA share one Case context without sharing product-local state. |
| `P1-010` | **Case CRUD UI in SHADOW** — Create/list/open/update/close Case and create investigations. | frontend | P1-009,P1-004 | User can complete basic protected Case lifecycle. |

### Phase exit gate

Phase `P1` exits only when all tasks required for **M1 Protected Case Shell** pass their automated tests and applicable Architecture Gates.

# P2 — Subject → Resolution → Entity Registry

**Milestone:** M2 Reusable Identity Core

**Goal:** Membuat identity pipeline aman: unknown subject → candidate → human resolution → reusable Entity.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P2-001` | **InvestigationSubject aggregate** — Subject type, role, lifecycle, entity linkage and revision. | backend | P1-004 | RESOLVED requires valid canonical Entity reference. |
| `P2-002` | **SubjectSeed with field provenance** — Typed seed fields, origin, evidence/source refs and classification. | backend | P2-001 | Every seed field can explain where it came from. |
| `P2-003` | **Entity Registry aggregate** — Thin Entity, alias, canonical label, stable status and workspace scope. | backend | P1-002 | Entity contains identity only, not case allegations. |
| `P2-004` | **Secure Identifier storage** — Encrypted identifier values where needed, masked display and keyed comparison fingerprint/HMAC. | security | P2-003,P1-007 | Restricted identifiers never use plain hash for guessable identifiers; field-policy tests pass. |
| `P2-005` | **ResolutionSession and Candidate model** — Candidate lifecycle, source linkage, review session and decisions. | backend | P2-001,P2-003 | Candidate never becomes canonical by persistence side effect. |
| `P2-006` | **MatchingSignal / ConflictSignal model** — Explainable signals with strength and field visibility. | backend | P2-004,P2-005 | UI can explain match without exposing restricted value. |
| `P2-007` | **Workspace entity match query** — Governance-aware possible-match query against Entity Registry. | backend | P2-003,P2-006,P1-006 | Can reveal existence without leaking other Case context. |
| `P2-008` | **Atomic candidate resolution coordinator** — LINK_EXISTING/CREATE_NEW/REJECT/UNCERTAIN; atomic decision + entity link/create + subject resolve. | backend | P2-001,P2-003,P2-005 | No half-resolved state after failure; retries idempotent. |
| `P2-009` | **TargetProfileView read model** — Compose Entity + permitted Workspace Knowledge placeholder + Subject context + freshness metadata. | backend | P2-008 | No second Person source-of-truth table. |
| `P2-010` | **SHADOW Add Target & review UI** — Create Subject, seed, candidate compare and resolution actions. | frontend | P2-008,P2-009 | User can resolve/link/create target with masked-sensitive fields. |
| `P2-011` | **Entity merge baseline** — Auditable survivor merge, canonical ID resolution and preserved history. | backend | P2-003,P1-008 | Merged IDs remain resolvable; no destructive delete. |
| `P2-012` | **Entity split/reverse-merge design hook** — Provide merge decision artifact and reverse command contract; full complex split may remain later. | backend | P2-011 | Architecture supports correcting a bad merge without editing history. |

### Phase exit gate

Phase `P2` exits only when all tasks required for **M2 Reusable Identity Core** pass their automated tests and applicable Architecture Gates.

# P3 — Workflow & Execution Runtime

**Milestone:** M3 Reliable Async Runtime

**Goal:** Membangun generic execution plane sebelum connector production dipasang.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P3-001` | **NodeDefinition registry** — Versioned capability templates, typed inputs/outputs, policies and presentation metadata. | backend | P0-011 | NodeDefinition requests capability, not connector implementation. |
| `P3-002` | **NodeInstance and InputBinding** — Investigation-scoped node config, typed bindings and workflow edges. | backend | P3-001,P1-004 | Invalid typed bindings rejected before execution. |
| `P3-003` | **Run aggregate** — Immutable input/config/access snapshots, status, trigger, parent/retry lineage. | backend | P3-002,P0-006 | Editing node after run does not alter historical run. |
| `P3-004` | **ExecutionAttempt aggregate** — Attempt lease, heartbeat, worker identity and terminal status. | backend | P3-003 | Infrastructure retry creates new Attempt on same Run. |
| `P3-005` | **ExecutionPlan contract** — Immutable worker-facing plan with capability, connector, input, limits, access context and checkpoint. | backend | P3-003 | No plain secrets or unrestricted DB objects in plan. |
| `P3-006` | **Outbox dispatcher to BullMQ** — Dispatch minimal run reference to coarse queues with safe retry. | backend | P0-007,P3-003 | Broker outage does not roll back committed Run; replay is idempotent. |
| `P3-007` | **Connector worker runtime skeleton** — Consume run reference, fetch plan, create attempt, heartbeat and finish/fail. | worker | P3-004,P3-005,P3-006 | Worker has no direct business DB write. |
| `P3-008` | **Internal service authentication** — Service identity for internal API; worker never impersonates browser user token. | security | P1-001,P3-007 | Unauthorized internal request rejected and auditable. |
| `P3-009` | **Checkpoint and resume primitive** — Opaque checkpoint with connector/checkpoint version. | backend | P3-004 | New Attempt can resume when connector supports it. |
| `P3-010` | **Cancellation semantics** — Cooperative cancel request, partial result preservation and worker signal. | backend | P3-007,P3-009 | Cancel never silently deletes already-ingested evidence. |
| `P3-011` | **Retry taxonomy** — Retryable/non-retryable errors, infra retry vs user/business retry. | backend | P3-004 | User retry creates new Run with retryOf; infra retry does not. |
| `P3-012` | **Parent/child run orchestration** — Fan-out/fan-in and completion policies ALLOW_PARTIAL/REQUIRE_ALL. | backend | P3-003,P3-011 | Partial child failure produces deterministic parent outcome. |
| `P3-013` | **SSE run progress** — Minimal authorized RUN_STATUS/RUN_PROGRESS events. | backend | P3-003,P0-010 | Reconnect/refetch remains source of truth; no sensitive payload broadcast. |
| `P3-014` | **Execution failure/replay tests** — Crash, duplicate delivery, lease loss, outbox replay and cancel tests. | quality | P3-006,P3-007,P3-011 | At-least-once execution does not create duplicate canonical effects. |

### Phase exit gate

Phase `P3` exits only when all tasks required for **M3 Reliable Async Runtime** pass their automated tests and applicable Architecture Gates.

# P4 — Source Registry, Resident Connector & Evidence

**Milestone:** M4 Person Lookup End-to-End

**Goal:** Menghasilkan vertical slice pertama dari SHADOW ke Hono Resident API hingga candidate dengan provenance.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P4-001` | **Source Registry domain** — DataSourceDefinition, ConnectorDefinition, Capability, source policy/trust and execution profile. | backend | P1-007 | DataSource, Connector and Capability remain separate concepts. |
| `P4-002` | **Connector resolution policy** — Resolve eligible connector based on capability, governance, availability and preference. | backend | P4-001,P1-005 | Restricted connector cannot be selected without permission/reason context. |
| `P4-003` | **Connector SDK** — Standard validate/execute context, cancellation, progress, result envelope and error taxonomy. | worker | P3-007,P4-001 | Connector implementations pass contract tests. |
| `P4-004` | **Restricted worker routing** — connector.restricted queue/profile and separate network/secret permissions. | security | P3-006,P4-001 | General worker cannot reach restricted Resident API. |
| `P4-005` | **Resident Hono connector** — Semantic Person Lookup client; no Elasticsearch DSL; normalize source envelope only. | worker | P4-003,P4-004 | Platform only calls Hono; timeout/rate-limit/error mapping tested. |
| `P4-006` | **Evidence SourceRecord model** — Immutable source metadata, run/connector/source lineage and payload reference policy. | backend | P3-003,P4-001 | Every evidence path can trace back to source + run. |
| `P4-007` | **Observation model and normalization entrypoint** — PersonObservation/ActivityObservation structure and observed-at semantics. | backend | P4-006 | Observation states what source reported, not canonical truth. |
| `P4-008` | **Idempotent source-batch ingestion** — Internal batch API, batch idempotency and record identity dedupe. | backend | P4-006,P3-008 | Duplicate batch delivery has same effect. |
| `P4-009` | **Raw payload retention enforcement** — Persist/omit/redact raw based on DataSource policy and classification. | security | P4-001,P4-006,P1-007 | Resident raw persistence defaults to policy-minimized behavior. |
| `P4-010` | **Resident result → PersonCandidate processing** — Convert allowed observations into Resolution candidates with source trust separated from match confidence. | backend | P4-007,P2-005 | ES/source relevance never becomes identity confidence. |
| `P4-011` | **Person Lookup NodeDefinition** — Capability PERSON_LOOKUP, config schema, review policy and source preference. | backend | P3-001,P4-002 | Node remains source-agnostic. |
| `P4-012` | **SHADOW Person Lookup end-to-end** — Run lookup, stream status, show candidates, resolve to Entity, show provenance. | fullstack | P4-005,P4-008,P4-010,P2-010,P3-013 | North-star identity slice works without direct ES access. |
| `P4-013` | **Restricted access audit** — Durable RESTRICTED_SOURCE_QUERY audit with actor/case/run/reason, no raw NIK. | security | P4-012,P1-008 | Audit trail supports compliance without leaking restricted values. |

### Phase exit gate

Phase `P4` exits only when all tasks required for **M4 Person Lookup End-to-End** pass their automated tests and applicable Architecture Gates.

# P5 — Knowledge & ECHO MVP

**Milestone:** M5 Curated Knowledge Graph

**Goal:** Membangun Case/Workspace Knowledge dan ECHO graph tanpa menjadikan graph database sebagai source of truth.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P5-001` | **Claim aggregate** — Case/Workspace scope, predicate/object, status, evidence links and revision. | backend | P2-003,P4-006 | Conflicting claims can coexist and preserve provenance. |
| `P5-002` | **Relationship aggregate** — Entity-to-Entity typed relation, scope, temporal validity, status and evidence links. | backend | P2-003,P4-006 | Relationship validates canonical Entity refs. |
| `P5-003` | **Relationship ontology registry** — Controlled predicates and semantics from ontology document. | backend | P5-002 | Unknown/ambiguous predicate cannot silently bypass ontology. |
| `P5-004` | **Knowledge promotion** — Explicit Case → Workspace artifact with lineage and decision. | backend | P5-001,P5-002,P1-005 | Case confirmation never mutates scope into Workspace implicitly. |
| `P5-005` | **Knowledge revision/revocation** — History-preserving revision/revoke with affected-case signals. | backend | P5-004 | Old findings remain tied to historical revision. |
| `P5-006` | **Knowledge conflict detection baseline** — Flag contradictory values/relations for review without deleting either. | backend | P5-001,P5-002 | Conflict appears as review state, not last-write-wins. |
| `P5-007` | **ECHO graph read model** — Entity nodes plus Workspace Knowledge, Case Knowledge and candidate layers. | backend | P5-001,P5-002,P2-003 | Read model can be rebuilt from canonical relational state. |
| `P5-008` | **ECHO graph UI foundation** — Layered graph, inspector, filters, solid/dashed candidate styling and case context. | frontend | P5-007 | User can distinguish knowledge vs candidate visually. |
| `P5-009` | **Relationship candidate review UI** — Confirm/reject/investigate candidate relation with evidence context. | frontend | P5-008 | Confirm creates Case Relationship only after explicit action. |
| `P5-010` | **Merge/identity review in ECHO** — Compare entities, merge decision and history display. | frontend | P2-011,P5-008 | User sees why merge happened and can identify survivor. |
| `P5-011` | **Activity overlay contract stub** — ActivityCorrelationSummary contract without high-volume implementation yet. | backend | P5-007 | ECHO can add overlay later without changing knowledge ownership. |

### Phase exit gate

Phase `P5` exits only when all tasks required for **M5 Curated Knowledge Graph** pass their automated tests and applicable Architecture Gates.

# P6 — Dataset & Analysis Foundation

**Milestone:** M6 Reproducible Analysis

**Goal:** Menjamin analysis reproducible dan tidak menulis langsung ke Evidence/Knowledge.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P6-001` | **DatasetSnapshot aggregate** — Immutable membership, lineage, item count and readiness lifecycle. | backend | P4-006 | READY snapshot membership cannot mutate. |
| `P6-002` | **DatasetView aggregate** — Dynamic filter/view distinct from snapshot. | backend | P6-001 | Analysis cannot accept mutable view without snapshot conversion. |
| `P6-003` | **Completeness model** — COMPLETE/PARTIAL/UNKNOWN with explicit reason codes. | backend | P6-001 | Analysis/result UI can surface input limitations. |
| `P6-004` | **AttributionContext model** — Represent account/entity attribution certainty on dataset inputs. | backend | P6-001,P2-003 | Analysis cannot silently overclaim Person ownership of uncertain account. |
| `P6-005` | **AnalysisDefinition registry** — Versioned analysis keys, input/output contract and config schema. | backend | P3-001 | Definition semantic version separated from resource revision. |
| `P6-006` | **Analysis request control-plane** — Create analysis metadata + Run for immutable dataset snapshot. | backend | P6-001,P6-005,P3-003 | Returns 202 + runId; input snapshot preserved. |
| `P6-007` | **Intelligence worker runtime** — Fetch analysis plan, execute handler, register results/artifacts through internal API. | worker | P6-006,P3-008 | No direct canonical DB write. |
| `P6-008` | **AnalysisResult persistence** — Immutable model/version/config/input lineage and artifact refs. | backend | P6-007 | Multiple model versions can coexist for same Evidence. |
| `P6-009` | **Basic entity extraction analysis** — Extract entity mentions as candidates with evidence offsets/refs where available. | worker | P6-008,P2-005 | Extraction creates Candidate, never canonical Entity. |
| `P6-010` | **Basic sentiment analysis capability** — Per-item + aggregate result with model metadata. | worker | P6-008 | Result never mutates Evidence.sentiment. |
| `P6-011` | **Analysis lineage UI** — Show dataset completeness, model/version, source evidence and caveats. | frontend | P6-008 | Analyst can answer 'how was this result produced?'. |

### Phase exit gate

Phase `P6` exits only when all tasks required for **M6 Reproducible Analysis** pass their automated tests and applicable Architecture Gates.

# P7 — Monitoring & SPECTRA MVP

**Milestone:** M7 Continuous Intelligence

**Goal:** Membangun monitoring loop yang menggunakan execution/evidence/analysis foundation yang sama.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P7-001` | **MonitoringTarget aggregate** — Case-scoped target referencing Entity when possible. | backend | P2-003 | No copied SocialAccount profile as monitoring truth. |
| `P7-002` | **MonitoringSchedule** — Recurring schedule metadata and due-state; no connector-specific engine. | backend | P7-001,P3-003 | Due schedule creates standard Run through execution pipeline. |
| `P7-003` | **MonitoringRule versioning** — Versioned condition/config/severity and enable state. | backend | P7-001 | Historical alerts retain rule version. |
| `P7-004` | **Alert aggregate** — Lifecycle OPEN/ACKNOWLEDGED/INVESTIGATING/RESOLVED/DISMISSED and resource lineage. | backend | P7-003 | Alert is not Finding. |
| `P7-005` | **Alert grouping/dedup** — Incident key/group repeated evaluations into one active issue where appropriate. | backend | P7-004 | 15-minute schedule does not create duplicate incident spam. |
| `P7-006` | **Monitoring scheduler/dispatcher** — Find due schedules and request normal Workflow/Execution runs. | backend | P7-002,P3-006 | No direct connector call from Monitoring module. |
| `P7-007` | **Social/news connector MVP** — Implement at least one authorized high-value source after its specific API contract is available. | worker | P4-003,P7-006 | Connector follows SDK, rate limit and source policy. |
| `P7-008` | **Activity Evidence normalization** — Post/reply/mention/repost evidence, versions, tombstones and engagement snapshots. | backend | P4-007,P7-007 | Edited/deleted content history preserved. |
| `P7-009` | **Monitoring dataset materialization** — Create immutable snapshot per monitoring collection window/run. | backend | P7-008,P6-001 | Completeness propagated from connector/run. |
| `P7-010` | **Rule evaluation from AnalysisResult** — Evaluate monitoring rules against analysis/baseline, not mutate analysis result. | backend | P7-003,P6-008 | Alert lineage points to analysis + rule version. |
| `P7-011` | **SPECTRA overview UI** — Targets, alerts, recent activity, news, sentiment and top engagement summaries. | frontend | P7-004,P7-008,P6-010 | Detailed source provenance remains accessible. |
| `P7-012` | **SPECTRA activity explorer** — Cursor-paginated activity filters, evidence detail and timeline. | frontend | P7-008 | High-volume list does not load entire dataset into browser. |
| `P7-013` | **SPECTRA alert workflow** — Acknowledge/investigate/resolve/dismiss with audit. | frontend | P7-004,P1-008 | All status actions use canonical monitoring API. |
| `P7-014` | **Baseline/trend analysis** — Simple historical baseline and spike/trend result with explicit input window. | worker | P6-008,P7-009 | No hidden changing baseline; version/input window visible. |

### Phase exit gate

Phase `P7` exits only when all tasks required for **M7 Continuous Intelligence** pass their automated tests and applicable Architecture Gates.

# P8 — Recursive Discovery & Cross-App Loop

**Milestone:** M8 Investigation Intelligence Loop

**Goal:** Membuat hasil SPECTRA/ECHO dapat menjadi subject baru tanpa kehilangan provenance atau membuat canonical truth otomatis.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P8-001` | **Profile Inbox read model** — Unify unresolved subjects, candidates and discoveries into SHADOW inbox. | backend | P2-005,P6-009 | Read model does not become new source-of-truth aggregate. |
| `P8-002` | **RelationshipCandidate first-class contract** — Entity/candidate endpoints, signals, evidence and review status. | backend | P6-009,P5-002 | Candidate relation can reference unresolved target. |
| `P8-003` | **Investigate-target orchestration** — Create Subject/Seed from RelationshipCandidate with provenance. | backend | P8-001,P8-002,P2-001 | One command creates consistent SHADOW subject; no frontend multi-write race. |
| `P8-004` | **Candidate rebind after subject resolution** — Resolve candidate endpoint to PERSON-B while preserving original lineage. | backend | P8-003,P2-008 | Rebind does not confirm relationship. |
| `P8-005` | **DeepLinkTarget resolver** — Semantic cross-product routing preserving workspace/case/resource context. | frontend | P1-009 | No business domain stores physical app URL. |
| `P8-006` | **ECHO ↔ SHADOW handoff** — Investigate unknown relation target and return to updated graph. | frontend | P8-003,P8-005 | User remains in same Case context. |
| `P8-007` | **SPECTRA ↔ SHADOW/ECHO handoff** — Investigate extracted entity; explore analysis/correlation in ECHO. | frontend | P8-001,P8-005 | No payload copy across product boundaries. |
| `P8-008` | **Recursive discovery E2E test** — Known A → news/evidence → B candidate → Subject B → Entity B → relation review. | quality | P8-003,P8-004,P5-009 | Reference flow passes with full provenance and cross-case isolation. |

### Phase exit gate

Phase `P8` exits only when all tasks required for **M8 Investigation Intelligence Loop** pass their automated tests and applicable Architecture Gates.

# P9 — Hypothesis & Finding Reasoning Layer

**Milestone:** M9 Defensible Case Intelligence

**Goal:** Mengubah evidence/analysis menjadi reasoning dan analyst-approved finding yang defensible.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P9-001` | **Hypothesis aggregate** — Statement, lifecycle, assessment, confidence and subject refs. | backend | P1-003 | Hypothesis remains Case-scoped and is never canonical Knowledge. |
| `P9-002` | **Hypothesis resource links** — SUPPORTS/CONTRADICTS/CONTEXT/QUALIFIES with strength and notes. | backend | P9-001,P4-006 | Contradictory evidence is first-class. |
| `P9-003` | **Hypothesis assessment history** — Assessment/confidence/rationale revisions without silent overwrite. | backend | P9-001 | Review can reconstruct how conclusion changed. |
| `P9-004` | **Finding aggregate** — Type, statement, rationale, lifecycle, confidence, subject/time context. | backend | P1-003 | Finding remains Case-scoped. |
| `P9-005` | **Finding resource links with revision pinning** — Support/contradict/context/qualify links to immutable result or resource revision. | backend | P9-004,P4-006,P6-008 | Approved finding can be reconstructed later. |
| `P9-006` | **Finding review workflow** — Submit review, APPROVE/REQUEST_CHANGES/REJECT, governance hook. | backend | P9-004,P1-005 | Approved state only via review decision. |
| `P9-007` | **Finding supersede/retract** — Immutable-ish approved finding corrected through explicit lineage. | backend | P9-006 | No silent edits after approval. |
| `P9-008` | **Create finding from hypothesis** — Convenience orchestration that preserves links but leaves draft human-owned. | backend | P9-001,P9-004 | No automatic approval from supported hypothesis. |
| `P9-009` | **SHADOW findings UI** — Draft/review/approved views, rationale, supporting and contradicting material. | frontend | P9-006 | Reviewer sees contradictions before approval. |
| `P9-010` | **ECHO hypothesis mapping UI** — Map hypothesis to entities/evidence/relationships without mutating knowledge graph. | frontend | P9-002,P5-008 | Reasoning layer visually distinct from Knowledge layer. |
| `P9-011` | **SPECTRA create-hypothesis/draft-finding actions** — Create analyst-owned reasoning artifact from alert/analysis with conservative wording. | frontend | P7-011,P9-001,P9-004 | Machine output never creates approved finding. |
| `P9-012` | **Case intelligence feed integration** — Finding/hypothesis milestones emit IntelligenceHighlight. | backend | P9-006 | Feed records intelligence milestones, not audit/log noise. |

### Phase exit gate

Phase `P9` exits only when all tasks required for **M9 Defensible Case Intelligence** pass their automated tests and applicable Architecture Gates.

# P10 — Search Projection & Indexing

**Milestone:** M10 Fast Investigation Search

**Goal:** Menyediakan search/read performance tanpa menjadikan Elasticsearch canonical store.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P10-001` | **Investigation search schemas** — Versioned index mappings for authorized Entity/Evidence/Finding searchable projections. | backend | P2-003,P4-006,P9-004 | No Resident raw index bulk copy. |
| `P10-002` | **Projection outbox events** — Emit rebuildable index events from canonical changes. | backend | P0-007 | Canonical transaction succeeds independently from ES availability. |
| `P10-003` | **Indexing worker** — Consume projection events, idempotently update Investigation Elasticsearch. | worker | P10-001,P10-002 | Replay can rebuild index safely. |
| `P10-004` | **Governance-aware search query** — Scope/classification filters applied before disclosure; no ES DSL passthrough. | backend | P1-005,P10-003 | Cross-case restricted result does not leak title/snippet. |
| `P10-005` | **Workspace Target Profile search** — Fast entity/profile search with masked match metadata. | backend | P10-004,P2-009 | Supports reuse-first Add Target UX. |
| `P10-006` | **Generic platform search** — Search Entity/Evidence/Finding with typed ResourceRef results and cursor. | backend | P10-004 | ES _score never exposed as identity confidence. |
| `P10-007` | **Projection freshness metadata** — generatedAt/projectionRevision/isStale on applicable read models. | backend | P10-003 | UI can distinguish eventual-consistency lag. |
| `P10-008` | **Search/load benchmarks** — Benchmark common search patterns and prevent expensive unbounded queries. | quality | P10-006 | Performance budget and access filtering validated under representative volume. |

### Phase exit gate

Phase `P10` exits only when all tasks required for **M10 Fast Investigation Search** pass their automated tests and applicable Architecture Gates.

# P11 — Hardening & Production Readiness

**Milestone:** M11 Production Candidate

**Goal:** Membuktikan security, reliability, recoverability, performance, operations dan release safety.

| ID | Task | Area | Dependencies | Acceptance |
|---|---|---|---|---|
| `P11-001` | **Threat-model review and abuse cases** — Update STRIDE-style model across API, workers, connectors, object store, search and cross-case flows. | security | P10-008 | All high risks have mitigation/owner or explicit accepted risk. |
| `P11-002` | **Authorization matrix integration tests** — Workspace/case/cross-case/field/source/export permission permutations. | security | P1-006,P4-013,P10-004 | No critical IDOR or sensitive-field disclosure. |
| `P11-003` | **Security headers and web hardening** — CSP, secure cookies where applicable, CSRF model, XSS-safe evidence rendering and upload/download controls. | security | P1-009 | Stored source content cannot execute arbitrary browser script. |
| `P11-004` | **Connector SSRF/egress hardening** — Allowlisted destinations, DNS/IP controls where relevant, timeout/body limits and redirect policy. | security | P4-003 | Connector input cannot turn runtime into generic proxy. |
| `P11-005` | **Secrets and key rotation procedure** — Secret inventory, rotation runbook, least privilege service identities and no secret in telemetry. | security | P4-004 | Rotation tested without data loss. |
| `P11-006` | **Dependency/supply-chain controls** — Lockfile integrity, vulnerability scanning, SBOM/artifact provenance and controlled updates. | devops | P0-013 | Critical dependency findings block release or have approved exception. |
| `P11-007` | **Performance/load test suite** — CRUD/read-model/search/ingestion/queue/SSE representative tests with documented budgets. | quality | P10-008 | No release if critical SLO regression exceeds agreed budget. |
| `P11-008` | **Backpressure and overload behavior** — Queue limits, rate limiting, concurrency controls, payload limits and graceful degradation. | backend | P11-007,P3-006 | Overload does not cause unbounded memory/DB growth. |
| `P11-009` | **Backup/restore and DR test** — PostgreSQL/object/search rebuild/Redis assumptions documented and restore drill executed. | devops | P10-003 | Canonical DB + object store restore verified; search rebuildable. |
| `P11-010` | **Retention and purge jobs** — Classification-aware lifecycle, hold support and auditable purge. | security | P1-007,P4-009 | Purge never removes held resources or audit-required records. |
| `P11-011` | **Export governance and watermarking baseline** — Authorized export job, redaction, signed URL, audit and expiry. | backend | P1-005,P9-004 | Export cannot bypass field/case classification policy. |
| `P11-012` | **Operational dashboards and alerts** — API error/latency, outbox lag, queue lag, worker failure, connector rate-limit, ingestion, analysis and schedule lag. | devops | P0-010 | On-call can identify failing layer via runId/traceId. |
| `P11-013` | **Incident response runbook** — Triage by requestId/runId, connector outage, queue backlog, auth outage, data leak suspicion and rollback. | docs | P11-012 | Runbook tested in tabletop exercise. |
| `P11-014` | **Release/rollback strategy** — Backward-compatible migration order, canary/staged deployment where possible and rollback playbook. | devops | P11-009 | Application rollback does not require unsafe destructive DB rollback. |
| `P11-015` | **Architecture compliance audit** — Run architecture gates, dependency graph, data ownership and anti-pattern review before production candidate. | quality | P0-013 | No known critical architecture gate violation. |

### Phase exit gate

Phase `P11` exits only when all tasks required for **M11 Production Candidate** pass their automated tests and applicable Architecture Gates.
