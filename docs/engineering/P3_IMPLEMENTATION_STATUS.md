# P3 implementation status — Reliable Async Runtime

## Baseline (2026-09-08)

P2-001 through P2-012 are implemented locally per `docs/engineering/P2_IMPLEMENTATION_STATUS.md`;
the P2 exit gate for M2 Reusable Identity Core is satisfied. P3 contains P3-001
through (at least) P3-012 and targets M3 Reliable Async Runtime. This document
covers P3-001 (NodeDefinition registry), P3-002 (NodeInstance/InputBinding/
WorkflowEdge) and P3-003 (Run aggregate) only. No commit, push, PR, database
migration, or deployment was performed by this implementation task.

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

## Deployment and rollback

Apply, in order: `workflow/infrastructure/persistence/migrations/
0001_create_node_definition.sql`, then `0002_create_node_instance.sql`, then
`execution/infrastructure/persistence/migrations/0001_create_run.sql`, then
`governance/infrastructure/persistence/migrations/
0004_workflow_run_permissions.sql`. The Governance migration replaces the
`governance_role_permissions_permission_check` CHECK constraint with a strict
superset (the same additive-only posture ADR-006 documents for
`0003_subject_permissions.sql`) and backfills the six new permissions onto the
three typed system Case roles only; no row is deleted and no custom role or
membership assignment is touched. `tooling/db/migrate.mjs`'s `ownerOrder` was
updated so a fresh database resolves `node_instances`' and `runs`' cross-module
foreign keys in the correct order; this ordering has no effect on an
already-migrated database. Rolling back the API build retains every
NodeDefinition, NodeInstance, WorkflowEdge, Run, their append-only history, and
their Outbox events; no destructive rollback is performed or required. Because
no worker consumes the `RUN_CREATED` Outbox event yet, every Run created
against this build will remain `QUEUED` indefinitely until a future task
(P3-004+) adds a consumer — this is expected, not a defect to work around.
