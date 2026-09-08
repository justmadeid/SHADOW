# ADR-019 — Run aggregate: frozen snapshot, atomic Outbox, business retry

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Execution backend; depends on Workflow (NodeInstance) and Case/Investigation

## Decision

Run is the logical business execution record described in
`docs/knowledge/07_WORKFLOW_EXECUTION_CONNECTORS.md` §7-9: `QUEUED / RUNNING /
COMPLETED / PARTIAL / FAILED / CANCELLED`, created only from a `READY` NodeInstance
(else `409 RUN_NODE_INSTANCE_NOT_READY`), requiring `RUN_CREATE` via
`CaseFacade.withAccess` and an `Idempotency-Key`. At creation the facade takes the
NodeInstance's current `configuration` and full `InputBinding` list and freezes them
into `inputSnapshot` — a structural copy only, never live-resolved values. Resolving
a `sourceExpression` against a live resource remains explicitly out of scope,
deferred to future Execution/ExecutionPlan work (P3-005+); this Run slice only
proves the snapshot is taken and stays immutable. `nodeDefinitionKey`/
`nodeDefinitionVersion` are copied from the NodeInstance at the same instant.
Editing the NodeInstance afterward (a `PATCH` to `configuration`) can never alter a
previously created Run's `inputSnapshot` or definition version — the literal P3-003
acceptance criterion, and a direct integration test proves it end to end: create a
Run, `PATCH` the NodeInstance's configuration, then re-fetch the original Run and
assert both fields are byte-identical to what they were at creation.

Run creation is one atomic unit: insert the Run row (`QUEUED`), the idempotency
record, one `run_revisions` history row, and exactly one metadata-only `RUN_CREATED`
Outbox event, all inside a single transaction (the Run+Outbox invariant from the
Execution Gate). The Outbox payload carries only `runId, workspaceId, caseId,
investigationId, nodeInstanceId, revision` — enum values and IDs, never raw
`configuration` or `InputBinding` values, matching
`assertSafeOutboxPayload`'s forbidden-key policy and this codebase's "no secrets in
job payload" rule. An integration test forces the Outbox insert to fail (the same
synthetic-trigger technique the Subject suite uses) and asserts the Run insert rolls
back with it.

Run is explicitly **not** ExecutionAttempt: this slice never creates, references, or
implies a physical attempt record. Nothing transitions a Run past `QUEUED` in this
slice — there is no worker, no ExecutionAttempt aggregate, no Outbox→BullMQ
dispatcher, and no internal service auth wired up yet (all deferred to P3-004+, per
the hard scope boundary this task was given). `startedAt`/`completedAt` are always
`null` here; inventing an auto-transition to `RUNNING`/`COMPLETED` would fabricate
progress that no worker actually produced, which the Execution Gate explicitly
forbids ("progress never fakes percentage"). A Run created by this slice sits in
`QUEUED` forever until a future task adds a consumer.

`POST /runs/{runId}/actions/cancel` only accepts `QUEUED`/`RUNNING` →
`CANCELLED`, requires `If-Match` and `RUN_CANCEL`, and appends a history row plus a
`RUN_CANCELLED` Outbox event under the same compare-and-set discipline.

`POST /runs/{runId}/actions/retry` only accepts a **terminal** `FAILED`/`PARTIAL`/
`CANCELLED` origin — `COMPLETED` is deliberately excluded, since a completed Run has
no business reason to retry. It re-validates the original NodeInstance is still
`READY`, takes a **fresh** snapshot of the NodeInstance's *current* state (not a
replay of the stale original `inputSnapshot` — that is the entire point of a
business retry, distinct from an infrastructure-level attempt retry), and creates a
genuinely new Run row (new id, `QUEUED`, `retryOf` = the original Run's id). It
requires the original Run's `If-Match` (so a client cannot retry against a Run
object it has not refreshed) and a fresh `Idempotency-Key`; the original Run's row
is read but never mutated by a retry. `parentRunId` is always `null` in this slice —
it exists purely as groundwork for a future P3-012 fan-out and is never set here.

`RunTrigger` is a one-value string union (`"MANUAL"` only) shaped as a `const`
array, so a future `"SCHEDULED"` trigger can be added additively without a breaking
type change, per docs/knowledge §23 "Manual & Scheduled Same" — this slice
implements only the manual path.

Governance gains `RUN_CREATE`, `RUN_VIEW`, `RUN_CANCEL` in the same additive
migration as ADR-018's `WORKFLOW_*` permissions. OWNER/EDITOR receive all three;
VIEWER receives only `RUN_VIEW`.

## Migration safety and rollout

`0001_create_run.sql` is additive only: `runs` (foreign keys into
`workspaces`/`cases`/`investigations`/`node_instances`, self-referencing nullable
`parent_run_id`/`retry_of`, a JSONB `input_snapshot` column, CHECK constraints on
`status`/`trigger`), `run_idempotency`, and `run_revisions` with the same
append-only-trigger pattern used by `subject_revisions`/`node_instance_revisions`.
Governance migration `0004_workflow_run_permissions.sql` replaces the permission
CHECK constraint with a strict superset (marked `-- migration-safety:
allow-destructive ADR-017`, following the `0003_subject_permissions.sql` template)
and backfills the new permissions onto the three typed system Case roles only —
custom roles and existing memberships are untouched. `tooling/db/migrate.mjs`'s
`ownerOrder` places `/modules/execution/` immediately after `/modules/workflow/`
(and after `/modules/investigation/`) so `runs`' foreign key into `node_instances`
resolves correctly on a fresh database. Rolling back the API build retains every
Run, its history, and its Outbox events; no destructive rollback is performed or
required.

## Verification

Unit tests cover: `createRun` producing `QUEUED`/null `startedAt`/`completedAt`/null
`parentRunId`, a frozen (mutation-throwing) `inputSnapshot`, `retryOf` propagation,
cancel-only-from-`QUEUED`/`RUNNING`, and retry-only-from-terminal excluding
`COMPLETED`. PostgreSQL/HTTP integration tests (real counts in
`docs/engineering/P3_IMPLEMENTATION_STATUS.md`) cover: the NodeInstance-not-READY
409 block on Run creation, the Run+Outbox atomic-rollback-on-Outbox-failure
scenario, the literal "editing node after run does not alter historical run"
acceptance test, idempotent create replay and conflicting-hash 409, revision-
mismatch 412 on cancel, cancel/retry state-machine rejection, business retry taking
a fresh (not stale) snapshot, authorization denial for a non-member and a VIEWER
attempting `RUN_CREATE`/`RUN_CANCEL`, and cross-Case/Workspace isolation on
`GET`/list.
