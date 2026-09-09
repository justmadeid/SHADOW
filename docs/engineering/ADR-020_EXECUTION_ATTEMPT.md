# ADR-020 — ExecutionAttempt: lease, heartbeat, worker identity, terminal status

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Execution backend; depends on P3-003 (Run aggregate)

## Decision

ExecutionAttempt is the physical attempt record described in
`docs/knowledge/07_WORKFLOW_EXECUTION_CONNECTORS.md` §8: `LEASED / RUNNING /
SUCCEEDED / FAILED / LOST`. Run != ExecutionAttempt (AGENTS.md, non-negotiable):
a Run is the logical business execution; an ExecutionAttempt is one physical
lease a worker holds on it. Both live in the `execution` module (not a new
top-level module) — `execution/domain/execution-attempt.ts`,
`execution-attempt-repository.ts`, `infrastructure/persistence/postgres-
execution-attempt.repository.ts`, `application/execution-attempt.facade.ts`,
`presentation/http/execution-attempt.controller.ts`. Run's own domain module
(`run.ts`) gained three ExecutionAttempt-driven transitions —
`startRun` (QUEUED -> RUNNING), `requeueRun` (RUNNING -> QUEUED, used on a
retryable fail), `terminateRun` (RUNNING -> COMPLETED/PARTIAL/FAILED) — none
of which are reachable from Run's own public `api/v1` controller; that
controller is untouched from what P3-003 left it (create/get/list/cancel/
retry only).

All new HTTP surface is `internal/v1` — a different trust boundary from
`api/v1`, per AGENTS.md ("Public API `/api/v1`; internal worker API
`/internal/v1`") and `docs/knowledge/15_PLATFORM_API_CONTRACT_MAP.md` §15
("Worker memakai service principal, bukan browser user token"). Every method
on `ExecutionAttemptController` calls a private `requireServiceId()` inside
`ExecutionAttemptFacade` — the mirror image of every other facade's
`requireUserId()` — and rejects a `USER` principal with `403
AUTH_SERVICE_REQUIRED`. No `CaseFacade.withAccess`/Case-membership permission
check is used here, and no new Governance `CASE_ROLE_PERMISSIONS` entry was
added for these routes: a worker is a trusted service principal acting on
behalf of the platform, not a Case member, so Case-membership authorization is
the wrong model for this boundary.

`POST /internal/v1/runs/{runId}/attempts` (body `leaseOwner`, 1-200 chars
opaque worker-instance token; `leaseDurationSeconds`, 1-300) requires
`Idempotency-Key`, scoped by `(workerIdentity, idempotencyKey)` — the same
replay/409-on-hash-mismatch pattern as Run's own idempotency table, in a
sibling `execution_attempt_idempotency` table. It rejects a terminal Run with
`409 RUN_NOT_ATTEMPTABLE`, and a still-live attempt (LEASED/RUNNING with an
unexpired lease) with `409 RUN_ATTEMPT_ALREADY_ACTIVE` — only one live attempt
per Run at a time. Lease expiry is detected lazily: if the Run's most recent
attempt is LEASED/RUNNING but its lease has already passed, the create call
first marks it `LOST` (no background sweep/scheduler exists or is needed —
the next create-attempt call is the only place this needs to be noticed), then
proceeds. `attemptNumber` is always server-computed (previous max + 1 for the
Run), never caller-supplied. If the Run was `QUEUED` this is also the point
`startRun` transitions it to `RUNNING` and sets `startedAt` for the first
time (P3-003 always left this null); if the Run was already `RUNNING` (a
retry attempt after a `LOST` predecessor) it is left as-is. Exactly one
metadata-only `RUN_ATTEMPT_CREATED` Outbox event is enqueued (`runId,
attemptId, attemptNumber, revision`) — the implicit Run QUEUED->RUNNING
transition inside the same call does not get its own event, since
`RUN_ATTEMPT_CREATED` already signals it.

`POST /internal/v1/runs/{runId}/progress` (body `attemptId, stage,
processed?, produced?, total?`) is the only heartbeat mechanism — there is no
separate heartbeat endpoint, matching `docs/knowledge/15_...md` §15 which
lists only `progress`. It requires `attemptId` to be the Run's current active
attempt (LEASED/RUNNING, unexpired) — a stale or wrong attemptId is `404
EXECUTION_ATTEMPT_NOT_FOUND` (unknown) or `409 RUN_ATTEMPT_NOT_ACTIVE`
(known but no longer live). On success it extends `leasedUntil = now +
leaseDurationSeconds` (the value fixed at attempt-creation time), flips
`LEASED -> RUNNING` on first call, and records `lastProgress`. `total` stays
nullable and is never used to derive a percentage anywhere in this code path
— the Execution Gate's "progress never fakes a percentage when total is
unknown" is structurally true because nothing computes one. No `If-Match`/
revision check applies here: correctness comes from `attemptId` having to
match the currently-active attempt, not from optimistic concurrency, since
this is a lease-holder operation, not a business mutation. No Outbox event is
enqueued for progress — a frequent, non-critical heartbeat is not a
state-machine transition worth one.

`POST /internal/v1/runs/{runId}/actions/complete` (body `attemptId, outcome:
"COMPLETED"|"PARTIAL"`) requires `attemptId` to be the Run's current active
attempt, marks it `SUCCEEDED`, and terminates the Run with the given
outcome, both with `completedAt` set. It is the one endpoint in this slice
required to be idempotent by exact replay: if the Run is already terminal
with this same attempt+outcome, it returns the current state instead of
erroring; a terminal Run reached via a different attempt or outcome is `409
RUN_ALREADY_TERMINAL`. One metadata-only `RUN_COMPLETED`/`RUN_PARTIAL`
Outbox event is enqueued.

`POST /internal/v1/runs/{runId}/actions/fail` (body `attemptId, errorCode:
^[A-Z][A-Z0-9_]{2,63}$, retryable: boolean`) requires `attemptId` to be the
Run's current active attempt, marks it `FAILED` with `errorCode`/`retryable`/
`completedAt`. `retryable: true` calls `requeueRun` (Run -> `QUEUED`) — this
is the literal mechanism behind the P3-004 acceptance criterion
("infrastructure retry creates new Attempt on same Run"), proven end to end
by a direct integration test: create attempt #1 on a Run, fail it retryable,
then successfully create attempt #2 on the *same* `runId` and assert
`attemptNumber` is 2. `retryable: false` calls `terminateRun(..., "FAILED",
...)`. One metadata-only `RUN_ATTEMPT_FAILED` Outbox event is enqueued
(`runId, attemptId, errorCode, retryable, revision` — never any free-text
detail beyond the controlled `errorCode`). Unlike `complete`, `fail` is not
required to be idempotent by this task's spec and is not implemented as such:
a second `fail` call against the same now-non-active attempt correctly falls
through to `409 RUN_ATTEMPT_NOT_ACTIVE`.

Only a `boolean retryable` flag exists on the fail action in this slice — no
error-code taxonomy (retryable-by-code table, `SOURCE_TIMEOUT` vs
`SOURCE_PERMISSION_DENIED` semantics, etc.) is implemented; that is P3-011.

No append-only history sub-table exists for `execution_attempts`
(`0002_create_execution_attempt.sql`), unlike Subject/NodeInstance/Entity/Run.
This is a deliberate scope decision: ExecutionAttempt is an ephemeral
execution record — a worker's lease on a Run — not a business identity or
knowledge record the Audit Gate or Rule 10 provenance requirements are aimed
at (those apply to Subject/Entity/Evidence/Hypothesis/Finding and to Run
itself, which retains its own `run_revisions` history, still written on every
ExecutionAttempt-driven Run transition). A plain `revision` column with
compare-and-set on the state-changing calls (`progress` excepted, as
explained above) is sufficient. `execution_attempt_idempotency` mirrors
`run_idempotency`'s shape exactly, keyed by `(worker_identity,
idempotency_key)` instead of `(user_id, idempotency_key)`.

`PUT /internal/v1/runs/{runId}/checkpoint` from the contract map is
explicitly **not** implemented — checkpoint/resume is P3-009. Richer
cancellation semantics beyond what P3-003 already has, and internal-service-
auth hardening beyond the basic SERVICE-principal check, are P3-008/out of
scope here.

## Migration safety and rollout

`0002_create_execution_attempt.sql` is additive only, applied after
`0001_create_run.sql`: `execution_attempts` (FKs into `runs`/`workspaces`/
`cases`, `UNIQUE (run_id, attempt_number)`, CHECK constraints on `status`/
`lease_duration_seconds`/`revision`, a partial index on the active-lease
lookup) and `execution_attempt_idempotency`. No existing table, index, or
constraint is altered. Rolling back the API build retains every
ExecutionAttempt and Run history row; no destructive rollback is performed or
required.

## Verification

Unit tests (`execution-attempt.spec.ts`, plus new cases in `run.spec.ts`)
cover: `createExecutionAttempt` starting `LEASED` with `leasedUntil = now +
leaseDurationSeconds`, lease bounds (1-300s) and `leaseOwner` bounds
(1-200 chars), `isAttemptActive`/`isAttemptLeaseExpired`, lazy `LOST`
transition and its precondition, `recordAttemptProgress` flipping
`LEASED -> RUNNING`/extending the lease/never deriving a percentage from
`total`, `succeedAttempt`/`failAttempt` setting `completedAt` and validating
`errorCode`'s pattern, and `startRun`/`requeueRun`/`terminateRun`'s status-
machine preconditions on Run. PostgreSQL/HTTP integration tests (real counts
in `docs/engineering/P3_IMPLEMENTATION_STATUS.md`) cover: `AUTH_SERVICE_REQUIRED`
for a USER principal, first-attempt creation moving the Run to `RUNNING` with
`startedAt` set, idempotent create replay and a conflicting-hash 409,
`RUN_ATTEMPT_ALREADY_ACTIVE` while a lease is live, lazy lease-expiry
detection producing a second attempt on the same Run, `RUN_NOT_ATTEMPTABLE`
against a terminal Run, progress as a heartbeat (lease extension, `LEASED ->
RUNNING`) and its active-attempt rejection, the literal P3-004 acceptance
scenario (retryable fail -> requeue -> new attempt, same `runId`,
`attemptNumber` 2), a non-retryable fail terminating the Run, idempotent
complete replay and `RUN_ALREADY_TERMINAL` on a conflicting replay.
