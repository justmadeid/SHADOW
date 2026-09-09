# P3 implementation status — Reliable Async Runtime

## Baseline (2026-09-08)

P2-001 through P2-012 are implemented locally per `docs/engineering/P2_IMPLEMENTATION_STATUS.md`;
the P2 exit gate for M2 Reusable Identity Core is satisfied. P3 contains P3-001
through (at least) P3-012 and targets M3 Reliable Async Runtime. This document
covers P3-001 (NodeDefinition registry), P3-002 (NodeInstance/InputBinding/
WorkflowEdge), P3-003 (Run aggregate), P3-004 (ExecutionAttempt), P3-005
(ExecutionPlan) and P3-006 (Outbox -> BullMQ dispatch). No commit, push, PR,
database migration, or deployment was performed by this implementation task.

## P3-001 — NodeDefinition registry implemented locally

Owner: Workflow backend; Governance owns permission tokens. NodeDefinition
requests an abstract capability, never a connector implementation. P0-011 is
present. Scope and rollout decisions are in
[ADR-017](ADR-017_NODE_DEFINITION_REGISTRY.md).

Implemented:

- Strict allow-list construction (`parseNodeDefinitionInput`) that structurally
  rejects any `connectorId`/`connector`/`sourceId` key — this is the literal
  P3-001 acceptance criterion, proven by a dedicated unit test — plus typed
  inputs/outputs/configSchema, execution/review policy, a Governance-registered
  `requiredPermission`, and presentation metadata.
- `NodeDefinitionRegistry` port: `register()` is a trusted internal application
  port (never wired to any HTTP controller), idempotent on exact key+version
  (identical-shape replay returns the existing row; a differing shape is
  `409 CONFLICT_NODE_DEFINITION_KEY_VERSION_REUSED`), plus `findByKeyVersion`,
  `findLatestActiveByKey` and cursor-paginated `list()`.
- Public read-only surface: `GET /node-definitions` (latest ACTIVE version per
  key, default 50/max 100) and `GET /node-definitions/{key}/versions/{version}`.
  Both require only an authenticated principal — no Case/Workspace scoping, since
  this is a global platform catalog. No public write endpoint exists.
- The catalog ships empty. No production NodeDefinition (e.g. a "person-lookup"
  business row) is seeded — that ownership belongs to a future Source
  Registry/connector task. Tests register synthetic NodeDefinitions directly
  through the trusted port.
- Forward-only migration `0001_create_node_definition.sql` (JSONB
  inputs/outputs/configSchema/policies/presentation, unique `(key, version)`).

### Deferred integration

Seeding any real capability (e.g. Person Lookup) and building a Source Registry/
ConnectorDefinition/Capability resolver are explicitly out of scope and belong to
a future task, per `docs/knowledge/07_WORKFLOW_EXECUTION_CONNECTORS.md` §11-14.

## P3-002 — NodeInstance, InputBinding and WorkflowEdge implemented locally

Owner: Workflow backend. Depends on P3-001 and P1-004 (Investigation, present).
Scope and rollout decisions are in
[ADR-018](ADR-018_NODE_INSTANCE_WORKFLOW.md).

Implemented:

- `POST /investigations/{investigationId}/nodes`: resolves the Investigation,
  reuses `CaseFacade.withAccess(caseId, "WORKFLOW_CREATE", ...)` and re-fetches
  the Investigation a second time inside that lock (mirrors
  `InvestigationFacade.update()`), requires an ACTIVE Investigation and an
  ACTIVE NodeDefinition, validates initial `configuration` against
  `configSchema`, and is Idempotency-Key-required with the standard
  replay/conflict pattern. Starts `DRAFT`, or `READY` immediately when zero
  inputs are required.
- `POST /nodes/{nodeInstanceId}/input-bindings` **replaces** the full binding
  set (delete+insert in one transaction, never a partial merge). Every
  `targetInput` must name a declared NodeDefinition input with no duplicates,
  and `sourceType` must equal that input's declared type — any violation is
  `400 VALIDATION_INPUT_BINDING_INVALID` with nothing persisted (proven by a
  direct integration test: the failed attempt leaves the NodeInstance's
  bindings, status and revision unchanged). This sourceType-must-match rule is
  the literal P3-002 acceptance criterion. Recomputes `READY` iff every
  required input is bound; requires `If-Match`.
- `PATCH /nodes/{nodeInstanceId}` updates `configuration` only (re-validated),
  requires `If-Match`, rejected once `ARCHIVED`. `DELETE /nodes/{nodeInstanceId}`
  soft-archives (sets status `ARCHIVED`, `204`) — never a real SQL `DELETE`.
- `POST /investigations/{investigationId}/workflow-edges` rejects a self-loop, a
  duplicate edge, either node missing from the Investigation, or a cycle (BFS
  over existing edges inside the same locked transaction).
- Append-only `node_instance_revisions` (status, a SHA-256 configuration hash —
  never raw configuration values — actor, time), protected by a reject-
  UPDATE/DELETE trigger identical in shape to `subject_revisions`.
- Governance gains `WORKFLOW_VIEW`/`WORKFLOW_CREATE`/`WORKFLOW_UPDATE`.
  OWNER/EDITOR get all three; VIEWER gets `WORKFLOW_VIEW` only.
- Forward-only migration `0002_create_node_instance.sql`
  (`node_instances`, `node_instance_idempotency`,
  `node_instance_input_bindings`, `node_instance_revisions`, `workflow_edges`).
- Deviation from the literal endpoint list: `GET /nodes/{nodeInstanceId}`
  (embedding the current InputBinding set) was added. The If-Match/ETag
  concurrency model this codebase uses everywhere is unusable without a way to
  read the current revision first, and every other resource has a paired GET;
  omitting it would have made NodeInstance the sole exception. No
  list-by-Investigation or list-edges endpoint was added.

### Deferred integration

Resolving a `sourceExpression` against a live resource, and consuming
`InputBinding`s to build an actual ExecutionPlan, are Execution/connector work
not claimed here (P3-005+).

## P3-003 — Run aggregate implemented locally

Owner: Execution backend; depends on P3-002 (NodeInstance) and P0-006
(transaction foundation, present). Scope and rollout decisions are in
[ADR-019](ADR-019_RUN_AGGREGATE.md).

Implemented:

- `POST /nodes/{nodeInstanceId}/actions/run`: requires the NodeInstance to be
  `READY` (else `409 RUN_NODE_INSTANCE_NOT_READY`), `RUN_CREATE` via
  `CaseFacade.withAccess`, and an `Idempotency-Key`. Atomically inserts the Run
  row (`QUEUED`), the idempotency record, one `run_revisions` history row, and
  exactly one metadata-only `RUN_CREATED` Outbox event (`runId, workspaceId,
  caseId, investigationId, nodeInstanceId, revision` only — never raw
  configuration/binding values). An integration test forces the Outbox insert
  to fail (synthetic trigger, mirroring the Subject suite's technique) and
  proves the Run insert rolls back with it.
- `inputSnapshot` freezes the NodeInstance's `configuration` and full
  `InputBinding` list at Run-creation time — a structural copy only, not
  live-resolved values (deferred to P3-005+). A direct integration test proves
  the literal P3-003 acceptance criterion: create a Run, `PATCH` the
  NodeInstance's `configuration`, re-fetch the original Run, and assert its
  `inputSnapshot`/`nodeDefinitionVersion`/`revision` are byte-identical to what
  they were at creation.
- `startedAt`/`completedAt` are always `null` and `parentRunId` is always
  `null` in this slice. No `complete`/`fail`/`progress`/attempt endpoint
  exists. There is no worker, ExecutionAttempt aggregate, Outbox→BullMQ
  dispatcher, or internal service auth in this slice (P3-004+) — a Run created
  here sits in `QUEUED` forever, by design, not by omission.
- `POST /runs/{runId}/actions/cancel`: `QUEUED`/`RUNNING` → `CANCELLED` only,
  requires `If-Match` and `RUN_CANCEL`.
- `POST /runs/{runId}/actions/retry`: only from a **terminal**
  `FAILED`/`PARTIAL`/`CANCELLED` Run (`COMPLETED` is deliberately excluded — a
  completed Run has no business reason to retry). Re-validates the NodeInstance
  is still `READY`, takes a **fresh** snapshot of its *current* state (not the
  original Run's stale snapshot), and creates a genuinely new Run with
  `retryOf` set to the original Run's id. Requires the original Run's
  `If-Match` and a new `Idempotency-Key`; the original Run row is never
  mutated by a retry.
- `RunTrigger` is `["MANUAL"]` shaped as a `const` array so a future
  `"SCHEDULED"` value can be added additively.
- Governance gains `RUN_CREATE`/`RUN_VIEW`/`RUN_CANCEL` in the same migration
  as P3-002's `WORKFLOW_*` permissions. OWNER/EDITOR get all three; VIEWER
  gets `RUN_VIEW` only.
- Forward-only migration `0001_create_run.sql` (`runs` — composite/self
  foreign keys, JSONB `input_snapshot`, `run_idempotency`, `run_revisions` with
  its append-only trigger).

### Deferred integration

ExecutionAttempt, the ExecutionPlan worker contract, the Outbox→BullMQ
dispatcher, the connector-worker runtime, `/internal/v1` service auth,
checkpoint/resume, richer cancellation, retry taxonomy, parent/child fan-out
execution and SSE progress are explicitly out of scope for P3-003 and remain
owned by P3-004 onward.

## P3-004 — ExecutionAttempt implemented locally

Owner: Execution backend; depends on P3-003 (Run, present). Scope and
rollout decisions are in [ADR-020](ADR-020_EXECUTION_ATTEMPT.md).

Implemented:

- New `internal/v1` trust boundary: every method on the new
  `ExecutionAttemptController` requires a SERVICE principal
  (`requireServiceId()`, mirroring every other facade's `requireUserId()`),
  rejecting a USER principal with `403 AUTH_SERVICE_REQUIRED`. No
  Case-membership permission check and no new `CASE_ROLE_PERMISSIONS` entry
  were added for these routes — a worker is a trusted service principal, not
  a Case member.
- `POST /internal/v1/runs/{runId}/attempts`: idempotent on `(workerIdentity,
  Idempotency-Key)`, `409 RUN_NOT_ATTEMPTABLE` against a terminal Run, `409
  RUN_ATTEMPT_ALREADY_ACTIVE` while a lease is live, lazy lease-expiry
  detection (a stale LEASED/RUNNING attempt is marked LOST before a new one
  is created — no background sweep/scheduler exists or is needed).
  `attemptNumber` is always server-computed. The first attempt for a Run
  transitions it QUEUED -> RUNNING and sets `startedAt` (P3-003 always left
  this null). Exactly one metadata-only `RUN_ATTEMPT_CREATED` Outbox event.
- `POST /internal/v1/runs/{runId}/progress`: the only heartbeat mechanism —
  extends the active attempt's lease, flips LEASED -> RUNNING on first call,
  records `lastProgress`. `total` stays nullable and is never used to derive
  a percentage. No `If-Match`/revision check (correctness comes from
  `attemptId` matching the current active attempt). No Outbox event.
- `POST /internal/v1/runs/{runId}/actions/complete`: marks the active
  attempt SUCCEEDED and the Run terminal with the given outcome. Idempotent
  by exact attempt+outcome replay; a conflicting replay is `409
  RUN_ALREADY_TERMINAL`. One metadata-only `RUN_COMPLETED`/`RUN_PARTIAL`
  Outbox event.
- `POST /internal/v1/runs/{runId}/actions/fail`: marks the active attempt
  FAILED with `errorCode`/`retryable`. `retryable: true` requeues the Run
  (QUEUED) — the literal mechanism behind the P3-004 acceptance criterion,
  proven by a direct integration test (attempt #1 fails retryable, attempt
  #2 is then created on the same `runId` with `attemptNumber` 2).
  `retryable: false` terminates the Run FAILED. One metadata-only
  `RUN_ATTEMPT_FAILED` Outbox event. Only a boolean `retryable` flag exists
  in this slice, not an error-code taxonomy (P3-011).
- `Run` gained three internal transitions (`startRun`, `requeueRun`,
  `terminateRun`) usable only from the ExecutionAttempt code path — Run's own
  public `api/v1` controller is unchanged from P3-003.
- No append-only history sub-table for `execution_attempts` (unlike
  Subject/NodeInstance/Entity/Run) — a deliberate scope decision documented
  in ADR-020: ExecutionAttempt is an ephemeral execution record, not a
  business identity/knowledge record the Audit Gate/Rule 10 provenance
  requirements target. A plain `revision` column with compare-and-set is
  sufficient. Run's own `run_revisions` history is still written on every
  ExecutionAttempt-driven Run transition.
- Forward-only migration `0002_create_execution_attempt.sql`
  (`execution_attempts`, `execution_attempt_idempotency`).

### Deferred integration

`PUT /internal/v1/runs/{runId}/checkpoint` (P3-009), richer
internal-service-auth hardening beyond the basic SERVICE-principal check
(P3-008), and the retry-error-code taxonomy (P3-011) are explicitly out of
scope.

## P3-005 — ExecutionPlan implemented locally

Owner: Execution backend; depends on P3-003 (Run) and P3-004
(ExecutionAttempt). Scope and rollout decisions are in
[ADR-021](ADR-021_EXECUTION_PLAN.md).

Implemented:

- `GET /internal/v1/runs/{runId}/execution-plan`: `requireServiceId()` only.
  Requires the Run to currently have an active (LEASED/RUNNING, unexpired)
  Attempt, else `409 RUN_EXECUTION_PLAN_NOT_AVAILABLE`. Composed (never
  persisted) from the Run, its active Attempt, and the pinned NodeDefinition
  resolved fresh via `NodeDefinitionFacade.findByKeyVersion` (already public
  through `WorkflowModule`'s export).
- `connector` and `checkpoint` are always `null` in this slice: Source
  Registry/connector resolution is P4-001+ and checkpoint/resume is P3-009,
  neither exists yet. The type is shaped so a real future value fits without
  a breaking change.
- `assertExecutionPlanIsSecretFree` structurally proves the literal P3-005
  acceptance criterion ("no plain secrets or unrestricted DB objects in
  plan"): a recursive key walk over the composed plan rejects any
  `secret`/`apiKey`/`token`/`credential`/`password`-shaped key. Called both
  inside `composeExecutionPlan` and again in the facade before the HTTP
  response is returned. A dedicated unit test proves the guard directly and
  independently walks a real composed plan's serialized keys.

### Deferred integration

Checkpoint/resume (P3-009) and Source Registry/connector resolution
(P4-001+) remain out of scope; `connector`/`checkpoint` stay structurally
`null`/absent-of-value until those tasks land.

## P3-006 — Outbox -> BullMQ dispatch implemented locally

Owner: Execution/Platform backend; depends on P0-007 (Outbox, present) and
P3-003 (Run). Scope and rollout decisions are in
[ADR-022](ADR-022_BULLMQ_OUTBOX_DISPATCH.md).

Implemented:

- `OutboxStore.claim()` gained an optional `eventTypes?: readonly string[]`
  parameter, implemented in `PostgresOutboxStore` as `AND event_type =
  ANY($eventTypes::text[])` applied only when provided — omitting it
  preserves the exact prior unfiltered behavior (proven by a dedicated
  integration test). `OutboxDispatcher.dispatchOnce()` threads the same
  optional parameter through to `claim()`.
- **The dispatch loop wired up for this task always calls `dispatchOnce({
  eventTypes: ["RUN_CREATED"], ... })`, never an unfiltered call.** This
  matters because `platform_outbox_events` is one physical table shared by
  every module (Case, Subject, Entity, Investigation, Governance, Workflow,
  Execution); an unfiltered claim against a publisher that only understands
  `RUN_CREATED` would silently mark every other module's historical events
  (`SUBJECT_CREATED`, `ENTITY_MERGED`, etc. — sitting unpublished since
  P0-P2, since `dispatchOnce()` had never been called by any production code
  path before this task) as "published" without ever delivering them. A
  dedicated integration test proves the safety property directly: a
  `SUBJECT_CREATED` event enqueued alongside a real `RUN_CREATED` event is
  left unclaimed and unpublished after a dispatch cycle.
- `BullMqOutboxPublisher implements OutboxPublisher`: routes only
  `RUN_CREATED` onto the single coarse `connector.general` BullMQ queue (no
  restricted pool exists yet — Source Registry doesn't exist to determine
  which Runs would need one). Job data is exactly `{ runId, outboxEventId }`
  — never the Outbox payload, never any config/binding/credential value.
  Job `jobId` is the Outbox event's own id, making a duplicate dispatch of
  the same event naturally deduplicated by BullMQ (proven by a dedicated
  test: publishing the same synthetic event twice leaves one job).
- A `setInterval`-based dispatch loop (5s, overlap-guarded) runs inside
  `platform-api`'s own process (`bootstrap/outbox-dispatch.ts`, started/
  stopped from `main.ts` alongside telemetry) — not a new deployable; the
  connector-worker that *consumes* `connector.general` is P3-007. Running
  this loop in multiple `platform-api` replicas is already safe via the
  `SELECT ... FOR UPDATE SKIP LOCKED` lease mechanism `OutboxStore.claim()`
  already had before this task.
- `REDIS_URL` added to `packages/config`'s environment schema (required,
  same pattern as `DATABASE_URL`) and to `.env.example`
  (`redis://127.0.0.1:6379`) — the `redis` service and `REDIS_PORT` already
  existed in `infrastructure/compose/docker-compose.dev.yml`/
  `.env.infrastructure.example`, provisioned in advance of this task.
  `bullmq` (`6.3.4`) and `ioredis` (`6.0.0`, not previously present anywhere
  in the workspace) added to `apps/platform-api/package.json`, both pinned
  to an exact version rather than this repo's usual caret style, deliberately
  for a newly introduced runtime dependency.
- **Broker outage does not roll back the committed Run**, proven for real by
  a dedicated integration test (not just asserted by inspection): a
  `BullMqOutboxPublisher` pointed at an unreachable Redis address, a Run
  created through the real HTTP path and confirmed committed/readable, one
  dispatch cycle run against it (asserted to fail gracefully via the
  existing `OutboxDispatcher` catch/`markFailed` path — no new retry logic
  was written), and the Run row confirmed untouched with the Outbox event
  still unpublished, `attemptCount` incremented and `availableAt`
  rescheduled.
- `packages/testing` gained `startRedisTestContainer` (the file already
  existed as unwired scaffolding — `containers/redis.ts` — from an earlier
  workspace setup commit; it was not exported from `src/index.ts` nor was
  its `testcontainers` dependency declared). Both gaps were fixed as part of
  this task: `testcontainers` added to `packages/testing/package.json`, and
  `startRedisTestContainer`/`StartedRedisTestContainer` exported from
  `src/index.ts` alongside the existing `startPostgresTestContainer`.

### Deferred integration

The connector-worker runtime that consumes `connector.general` (P3-007),
richer internal-service-auth hardening (P3-008), checkpoint/resume
(P3-009), the retry-error-code taxonomy (P3-011), and parent/child fan-out
dispatch (P3-012) remain out of scope.

## Deviation note

The requester's spec named `tooling/db/migrate.mjs`'s `ownerOrder` insertion
point as "after investigation, workflow before execution." The implementation
places `/modules/workflow/` and `/modules/execution/` immediately after
`/modules/investigation/` and before `/modules/subject/`, keeping
`/modules/subject/`, `/modules/governance/` and `/modules/resolution/` in their
prior relative order. This was necessary and sufficient: `node_instances` FKs
into `investigations`/`cases`/`workspaces` only, and `runs` FKs into
`node_instances`/`investigations`/`cases`/`workspaces` only — neither table
references `subject`, `governance`, or `resolution` tables, so no other
placement was required. No other deviation from the requester's brief was
made; every convention (module layout, error/etag/idempotency/outbox
patterns, append-only revision history, soft-archive over destructive delete)
was taken directly from the repository's existing Investigation/Subject/Case
modules and verified against the actual code before use.

## Validation (2026-09-08)

- Full `m0:static` passed: `check:architecture` (228 source files scanned, 6
  boundary tests, dependency graph — 274 modules/835 dependencies cruised,
  clean), `format:check` clean, `lint` clean (0 errors/warnings), `typecheck`
  passed across all 15 packages/apps, unit tests — **264 passed** across 37
  files (44 of those tests are new: 12 `node-definition.spec.ts`, 9
  `node-instance.spec.ts`, 5 `input-binding.spec.ts`, 7 `workflow-edge.spec.ts`,
  10 `run.spec.ts`, plus one existing `case-membership.spec.ts` assertion
  updated to include the two new Governance-registered VIEWER permissions),
  contract tests — 21 passed across 7 files (unchanged by this task),
  `migrations:validate` passed (25 SQL migrations), `contracts:lint` passed
  (`docs/contracts/platform-api-v1.yaml` is valid), and `build` succeeded for
  all 15 production packages/applications.
- Docker was available in this environment (`docker version 28.3.2`), so full
  PostgreSQL/HTTP integration testing was run for real, not skipped.
  `pnpm test:integration` passed **130 tests across all 16 integration test
  files** in the repository, including the **22 new scenarios** added by this
  task (13 in `workflow.integration.spec.ts`, 9 in
  `execution.integration.spec.ts`). Those 22 cover: idempotent NodeDefinition
  registration and the conflicting-shape 409, latest-ACTIVE-per-key listing,
  DRAFT-vs-READY-at-creation, idempotent NodeInstance create and a conflicting
  replay 409, configSchema validation rejection, ACTIVE NodeDefinition/
  Investigation enforcement (404/409), the InputBinding sourceType-mismatch
  acceptance criterion with a persisted-state check proving nothing was
  written, targetInput/duplicate rejection, PATCH + If-Match + 412 revision
  mismatch, soft-archive (204) and post-archive mutation rejection (409),
  WorkflowEdge self-loop/duplicate/cycle rejection, non-member/VIEWER
  authorization denial (404, matching this repository's hide-on-deny
  convention) plus a VIEWER read, cross-Case NodeInstance isolation, and an
  Outbox-failure rollback of the NodeInstance create transaction; and for Run:
  the NodeInstance-not-READY 409 block, idempotent create + conflicting replay
  409, the literal "editing node after run does not alter historical run"
  acceptance test, cancel state-machine enforcement (QUEUED/RUNNING only) with
  a 412 revision-mismatch case, retry-only-from-terminal with a fresh (not
  stale) snapshot and explicit COMPLETED exclusion, retry rejection when the
  NodeInstance is no longer READY, non-member/VIEWER authorization denial (404)
  with a VIEWER read and VIEWER-cancel denial, Case-scoped Run listing that
  hides cross-Case Runs, and an Outbox-failure rollback of the Run create
  transaction.
- Regression note: adding `WORKFLOW_*`/`RUN_*` to `CASE_ROLE_PERMISSIONS` (a
  shared Governance constant that every module's tests reference when
  bootstrapping a synthetic Case OWNER) required adding the new
  `governance/.../migrations/0004_workflow_run_permissions.sql` migration to
  the local Postgres bootstrap migration list of every **pre-existing**
  integration test file that creates a Case: `subject`, `investigation`,
  `resolution`, `audit`, `case-access`, `postgres-case`, `postgres-governance`,
  and `target-profile`. Their CHECK-constraint-violation failures were caught
  by running the full `test:integration` suite (not just the two new files)
  before considering this task done; all 9 files were fixed and the full suite
  now passes at 130/130. `entity.integration.spec.ts` needed no change — it
  never creates a Case. No existing test assertion was weakened; the one
  existing assertion that changed (`case-membership.spec.ts`'s exact VIEWER
  permission list) was extended to include the two new VIEWER-eligible
  permissions this task intentionally adds, matching the same pattern
  `0003_subject_permissions.sql` established for `SUBJECT_VIEW`.
- `pnpm audit --prod --audit-level=high` reports no known vulnerabilities.
  Gitleaks secret scanning was not run in this session (not part of the
  requester's explicit verification checklist for this task); no secrets were
  intentionally introduced, and Outbox payloads were verified metadata-only by
  code review and by `assertSafeOutboxPayload`'s existing forbidden-key policy.
- Existing SHADOW/ECHO Playwright regression and `pnpm test:e2e` were not run
  in this session — this task added no frontend/BFF surface, and the
  requester's checklist did not list e2e as a required gate.
- Test fixtures use disposable PostgreSQL (`@intelligence/testing`'s
  testcontainers helper) and synthetic authentication only. No user database
  migration, deployment, commit, push, or PR was performed by this
  implementation task.

## Validation — P3-004/005/006 (2026-09-08)

- Full `m0:static` passed after this task's changes: `check:architecture`
  (`check:boundaries` — 242 source files scanned, clean; `test:boundaries` —
  6/6 boundary tests pass; `check:deps` — 288 modules/912 dependencies
  cruised, 0 violations, after fixing one real off-by-one relative-import
  path bug this task introduced in
  `bullmq-outbox-dispatch.integration.spec.ts`, caught by this gate),
  `format:check` clean, `lint` clean (0 errors/warnings), `typecheck` passed
  across all 15 packages/apps (after fixing one real
  `exactOptionalPropertyTypes` violation in `outbox-dispatcher.ts`'s new
  `eventTypes` pass-through), unit tests — **288 passed** across 39 files (24
  of those tests are new: 14 `execution-attempt.spec.ts`, 3
  `execution-plan.spec.ts`, 7 new cases added to the existing `run.spec.ts`
  for `startRun`/`requeueRun`/`terminateRun`; one existing
  `packages/config/src/index.spec.ts` fixture was extended with `REDIS_URL`
  since the schema now requires it — no assertion was weakened, the fixture
  simply gained the new required field), contract tests — 21 passed across 7
  files (unchanged by this task), `migrations:validate` passed (26 SQL
  migrations, up from 25), `contracts:lint` passed
  (`docs/contracts/platform-api-v1.yaml` is valid, including the new
  `/internal/v1/*` paths and `ExecutionAttempt`/`ExecutionPlan` schemas), and
  `build` succeeded for all 15 production packages/applications.
- Docker was available in this environment (`docker version 28.3.2`,
  confirmed with both Postgres and Redis testcontainers actually starting),
  so full PostgreSQL/HTTP/Redis integration testing was run for real, not
  skipped. `pnpm test:integration` passed **148 tests across all 18
  integration test files** in the repository (up from 130 across 16),
  including the **18 new scenarios** added by this task: 13 in the new
  `execution-attempt.integration.spec.ts`, 3 in the new
  `bullmq-outbox-dispatch.integration.spec.ts`, and 2 new `eventTypes`-filter
  cases added to the existing `postgres-outbox.integration.spec.ts`.
  - `execution-attempt.integration.spec.ts` (13) covers: `AUTH_SERVICE_REQUIRED`
    rejection of a USER principal on an `internal/v1` route, first-attempt
    creation moving the Run `QUEUED -> RUNNING` with `startedAt` set,
    idempotent create replay and a conflicting-idempotency-key 409,
    `RUN_ATTEMPT_ALREADY_ACTIVE` while a lease is live, lazy lease-expiry
    detection producing `attemptNumber` 2 on the same Run (with the prior
    attempt's row confirmed `LOST` by direct query), `RUN_NOT_ATTEMPTABLE`
    against a cancelled (terminal) Run, progress-as-heartbeat (lease
    extension, `LEASED -> RUNNING`, `lastProgress` recorded) and its
    active-attempt rejection, **the literal P3-004 acceptance criterion**
    (retryable fail requeues the Run, then a second `POST .../attempts` on
    the *same* `runId` succeeds with `attemptNumber` 2), a non-retryable
    fail terminating the Run `FAILED`, idempotent-by-exact-replay `complete`
    and `RUN_ALREADY_TERMINAL` on a conflicting replay, and
    `RUN_EXECUTION_PLAN_NOT_AVAILABLE` before any Attempt exists versus a
    `200` plan (with `connector`/`checkpoint` asserted `null` and the full
    response body asserted to contain no secret-shaped key) once one does.
  - `bullmq-outbox-dispatch.integration.spec.ts` (3) covers: **the literal
    cross-module Outbox-safety property** (a `SUBJECT_CREATED` event enqueued
    alongside a real, HTTP-created `RUN_CREATED` event; after one filtered
    dispatch cycle the `RUN_CREATED` row is published and a BullMQ job
    exists for it, while the `SUBJECT_CREATED` row's `published_at` remains
    `null`), deterministic-`jobId` deduplication (publishing the same
    synthetic event twice against a real queue increases the job count by
    exactly 1), and **the literal broker-outage property** (a
    `BullMqOutboxPublisher` pointed at an unreachable Redis address; a Run
    created through the real HTTP path is confirmed committed and readable;
    one dispatch cycle is confirmed to fail gracefully via the existing
    `OutboxDispatcher` catch/`markFailed` path; the Run row is confirmed
    untouched and the Outbox event confirmed still unpublished with
    `attempt_count` incremented).
  - `postgres-outbox.integration.spec.ts` gained 2 cases: `claim({eventTypes:
    ["RUN_CREATED"]})` claims only that type and leaves a pending
    `SUBJECT_CREATED` row both unclaimed and unpublished; omitting
    `eventTypes` preserves the exact prior unfiltered behavior.
  - `resolution.integration.spec.ts`'s existing `vi.stubEnv(...)` fixture
    block (it loads `loadPlatformApiConfig()` for real inside
    `EnvironmentIdentifierProtection`) was extended with
    `REDIS_URL` — no assertion was weakened, the fixture simply gained the
    new required env var, the same pattern already used there for
    `DATABASE_URL`/OIDC/identifier-protection keys.
- **Two real bugs were found and fixed by actually running these gates,
  not just by code review**, both in `postgres-outbox.store.ts`'s new
  `eventTypes` filter: (1) the raw `sql` template's array parameter did not
  serialize into valid Postgres array syntax for a single-element array
  (`ANY($1::text[])` bound to a JS array produced `malformed array literal:
  "RUN_CREATED"` — the driver's default `Array.toString()` coercion, not
  `{RUN_CREATED}`), fixed by building `ANY(ARRAY[$1, $2, ...]::text[])` with
  `sql.join` over one bound parameter per event type instead of one
  array-typed parameter; (2) a relative-import off-by-one in the new
  `bullmq-outbox-dispatch.integration.spec.ts` (`../../../database/
  database.module.js` instead of `../../../../database/database.module.js`),
  caught by `check:deps` (`not-to-unresolvable`), not by `typecheck` — this
  repository's `tsconfig.json` excludes `*.integration.spec.ts` from
  `tsc --noEmit`, so `check:architecture`/actually running the integration
  suite are the only gates that would have caught it.
- `pnpm audit --prod --audit-level=high` reports **no known vulnerabilities**
  after adding `bullmq`/`ioredis` — the first new runtime dependencies added
  in several slices, called out explicitly per the requester's checklist.
  Gitleaks secret scanning was not run in this session (same posture as the
  prior P3-001/002/003 validation note); no secret was intentionally
  introduced, and every new Outbox/BullMQ job payload was verified
  metadata-only (`{runId, outboxEventId}` only) both by code review and by
  `assertSafeOutboxPayload` already running at `enqueue()` time.
- **Confirmed explicitly: the `eventTypes` filter was implemented in both
  `OutboxStore.claim()` (port) and `PostgresOutboxStore` (implementation),
  and the dispatch loop wired up for this task
  (`bootstrap/outbox-dispatch.ts`) always calls `dispatchOnce({ eventTypes:
  ["RUN_CREATED"], ... })` — an unfiltered `dispatchOnce()` call does not
  appear anywhere in the production dispatch path added by this task.** This
  is proven by the cross-module safety-property integration test described
  above, not asserted by inspection alone.
- Existing SHADOW/ECHO Playwright regression and `pnpm test:e2e` were not run
  in this session — this task added no frontend/BFF surface, and the
  requester's checklist did not list e2e as a required gate.

## Deployment and rollback

Apply, in order: `workflow/infrastructure/persistence/migrations/
0001_create_node_definition.sql`, then `0002_create_node_instance.sql`, then
`execution/infrastructure/persistence/migrations/0001_create_run.sql`, then
`0002_create_execution_attempt.sql`, then `governance/infrastructure/
persistence/migrations/0004_workflow_run_permissions.sql`. The Governance
migration replaces the `governance_role_permissions_permission_check` CHECK
constraint with a strict superset (the same additive-only posture ADR-006
documents for `0003_subject_permissions.sql`) and backfills the six new
permissions onto the three typed system Case roles only; no row is deleted
and no custom role or membership assignment is touched.
`0002_create_execution_attempt.sql` is additive only (new tables, no
existing table/index/constraint altered) and adds no new Governance
permission — ExecutionAttempt's `internal/v1` endpoints authorize on a
SERVICE principal, not Case membership. `tooling/db/migrate.mjs`'s
`ownerOrder` was updated so a fresh database resolves `node_instances`' and
`runs`' cross-module foreign keys in the correct order; this ordering has no
effect on an already-migrated database. Rolling back the API build retains
every NodeDefinition, NodeInstance, WorkflowEdge, Run, ExecutionAttempt,
their append-only/revision history, and their Outbox events; no destructive
rollback is performed or required.

**New runtime requirement:** `REDIS_URL` must be set (see `.env.example`) —
`packages/config`'s schema now requires it, so `platform-api` fails to start
without it. The `redis` service in
`infrastructure/compose/docker-compose.dev.yml` already existed
(provisioned in advance of this task); no compose file change was needed,
only the platform-api-level connection string.

Because P3-004/005/006 add the *producer* side only (ExecutionAttempt
lease/heartbeat/terminal-status endpoints, the ExecutionPlan read, and the
Outbox -> BullMQ `connector.general` dispatch loop) and no consumer exists
yet (`apps/connector-worker` is P3-007), a Run created against this build now
correctly reaches `RUNNING` once something calls `POST .../attempts` against
it and its `RUN_CREATED` job is placed on `connector.general` by the
dispatch loop — but nothing will actually call `POST .../attempts` until
P3-007 ships a worker. This is expected, not a defect to work around: the
same posture P3-003's status doc already described for `RUN_CREATED` sitting
unconsumed, now one layer further along the pipeline.
