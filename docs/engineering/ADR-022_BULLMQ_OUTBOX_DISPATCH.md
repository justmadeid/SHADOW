# ADR-022 — Outbox -> BullMQ dispatch: type-filtered claim, minimal job reference, safe retry

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Execution/Platform backend; depends on P0-007 (Outbox) and P3-003 (Run)

## Decision

The BullMQ publisher and its scheduled dispatch loop are a **platform
primitive extension of the existing Outbox infrastructure**, living under
`platform/events/outbox/infrastructure/queue/` (`bullmq-outbox-publisher.ts`,
`connector-general-queue.ts`) and `bootstrap/outbox-dispatch.ts` — not inside
the `execution` module, since `OutboxDispatcher`/`OutboxStore` are already
platform-wide primitives shared by every module, matching AGENTS.md's
"Outbox is dispatch truth; BullMQ is transport."

### The event-type filter (the one change most likely to cause real harm if done wrong)

`platform_outbox_events` is **one physical table shared by every module** in
this codebase — Case, Subject, Entity, Investigation, Governance, Workflow,
and Execution all `enqueue()` into it through their own `PostgresOutboxStore`
instance, but it is the same table. Before this task, `OutboxDispatcher`/
`OutboxStore.claim()` had no event-type filter, and `dispatchOnce()` had never
been called by any production code path since P0-007 — every `SUBJECT_CREATED`,
`CASE_UPDATED`, `ENTITY_MERGED`, `INVESTIGATION_CREATED`, `RUN_CREATED`, etc.
event enqueued since P0-P2 was still sitting unpublished in that table.
Wiring an unfiltered `dispatchOnce()` to a publisher that only understands
`RUN_CREATED` would silently mark every one of those historical events
"published" without ever actually delivering them — a real, if quiet,
data-integrity bug.

`OutboxStore.claim()` gained an **optional** `eventTypes?: readonly string[]`
parameter (`domain/outbox-store.ts`), implemented in `PostgresOutboxStore`
with `AND event_type = ANY($eventTypes::text[])` applied only when the
parameter is supplied — omitting it preserves the exact prior unfiltered
behavior, proven by a dedicated integration test alongside the new filtered
test in `postgres-outbox.integration.spec.ts`. `OutboxDispatcher.dispatchOnce()`
threads the same optional `eventTypes` straight through to `claim()`. The
dispatch loop wired up for this task **always** calls `dispatchOnce({
eventTypes: ["RUN_CREATED"], ... })` — never an unfiltered call. A dedicated
integration test (`bullmq-outbox-dispatch.integration.spec.ts`) proves the
safety property end to end: enqueue a `SUBJECT_CREATED` event alongside a
real `RUN_CREATED` event (created through the actual Run-creation HTTP path,
not synthesized), run one dispatch cycle against real Postgres and Redis
testcontainers, and assert only the `RUN_CREATED` row is claimed/published
while the `SUBJECT_CREATED` row's `publishedAt` remains `null` and it was
never handed to the publisher.

### Publisher and job shape

`BullMqOutboxPublisher implements OutboxPublisher`. `publish(event)` accepts
only `event.type === "RUN_CREATED"` — any other type reaching it (which
should be structurally impossible given the filtered dispatch loop above, but
is defended against anyway) throws rather than silently dropping or
mis-routing it, so the existing `OutboxDispatcher` failure path (log +
reschedule) handles it instead of a silent incorrect "published." It adds one
job to a single coarse BullMQ queue, `connector.general`
(`docs/knowledge/07_...md` §21) — there is no `connector.restricted` pool in
this slice, since Source Registry/connector resolution (P4-001+) does not
exist yet to determine which Runs would even need one. Job `name` is the
event type; job `data` is **exactly** `{ runId, outboxEventId }` — never the
Outbox payload, never any config/binding/credential value, satisfying
"dispatch minimal run reference." No secret ever reaches this publisher by
construction: `assertSafeOutboxPayload` already ran at `enqueue()` time back
in P3-003/P3-004, and this publisher does not even forward that payload to
the job, only the two IDs.

Job `jobId` is set to the Outbox event's own `id` — deterministic, not
randomly generated per publish call. This is what makes replay idempotent:
a duplicate dispatch attempt of the same Outbox row (e.g. a lease-loss race
re-claiming it before the first attempt's `markPublished` lands) adds a job
BullMQ already recognizes by that id and naturally deduplicates, rather than
enqueueing the same work twice. A dedicated test proves this directly:
publishing the same synthetic event twice against a real queue leaves exactly
one job behind.

### Scheduled dispatch loop

`bootstrap/outbox-dispatch.ts` starts a `setInterval`-based loop (5s) inside
`platform-api`'s own process — this task's backlog area is "backend," i.e.
platform-api, not a new deployable; `apps/connector-worker`, which only
*consumes* `connector.general`, is P3-007 and out of scope here. The loop
guards against overlapping ticks with a simple in-flight boolean (skip a tick
if the previous one has not finished) and calls `dispatchOnce({ leaseOwner:
<a per-process id>, eventTypes: ["RUN_CREATED"], batchSize: 50,
leaseDurationMs: 30_000 })`. Running this loop in multiple `platform-api`
replicas simultaneously is already safe without any new coordination: it
relies entirely on the lease/`SELECT ... FOR UPDATE SKIP LOCKED` mechanism
`OutboxStore.claim()` already had before this task, keyed by each process's
own `leaseOwner`. `main.ts` starts the loop after `app.listen()` (reusing the
already-`@Global()` `DatabaseContext` and `PLATFORM_LOGGER` providers via
`app.get(...)`, rather than adding new Nest DI wiring for it, matching how
`bootstrap/telemetry.ts` is already started/stopped outside the Nest module
graph) and stops it as part of the existing shutdown handler.

### Broker outage does not roll back the committed Run

This is true by construction, not by new retry logic: the Run insert commits
in its own database transaction (ADR-019's Run+Outbox atomicity) strictly
before any dispatch ever happens — dispatch is a separate, later, best-effort
step read from the already-committed Outbox row. A dedicated integration test
exercises this for real rather than asserting it by inspection: point a
`BullMqOutboxPublisher` at an unreachable Redis address
(`redis://127.0.0.1:65535`, nothing listening), create a Run through the real
HTTP path (asserting it commits and is immediately readable), run one
dispatch cycle (asserting it fails gracefully — the existing
`OutboxDispatcher.dispatchOnce()` catch/`markFailed`/backoff path handles
this, no new retry logic was written), and assert the Run row is untouched
and the Outbox event remains unpublished with an incremented `attemptCount`
and a rescheduled `availableAt`. The Redis connection used for dispatch sets
`enableOfflineQueue: false` and a short `connectTimeout`/no auto-reconnect
specifically so a broker outage fails a dispatch attempt promptly instead of
buffering indefinitely against an unreachable host.

### Dependencies

`bullmq` (`6.3.4`, pinned exact — not caret, unlike this repo's usual
dependency style, deliberately for a newly introduced runtime dependency) and
its required `ioredis` (`6.0.0`, pinned exact) were added to
`apps/platform-api/package.json`; `ioredis` was not already present anywhere
in the workspace. `REDIS_URL` was added to `packages/config`'s environment
schema (`z.string().min(1)`, required — the same pattern as `DATABASE_URL`)
and to `.env.example` (`redis://127.0.0.1:6379`, matching the `redis` service
and `REDIS_PORT` default already present in
`infrastructure/compose/docker-compose.dev.yml`/`.env.infrastructure.example`
— provisioned in advance of this task). `pnpm audit --prod --audit-level=high`
results are recorded in `docs/engineering/P3_IMPLEMENTATION_STATUS.md`.

### Deferred

The connector-worker runtime that consumes `connector.general` (P3-007),
richer internal-service-auth hardening (P3-008), checkpoint/resume
(P3-009), the retry-error-code taxonomy (P3-011), and parent/child fan-out
dispatch (P3-012) are all explicitly out of scope for this task.

## Verification

Integration tests (`postgres-outbox.integration.spec.ts`,
`bullmq-outbox-dispatch.integration.spec.ts`) cover: `claim({eventTypes})`
restricting the batch and leaving other pending events untouched, omitting
`eventTypes` preserving the prior unfiltered behavior, the literal
cross-module safety property (`SUBJECT_CREATED` left unpublished while
`RUN_CREATED` is dispatched), deterministic-`jobId` deduplication of a
duplicate publish, and the broker-outage property (committed Run unaffected,
Outbox event rescheduled and still unpublished). These require both
PostgreSQL and Redis testcontainers; availability in this environment is
recorded in `docs/engineering/P3_IMPLEMENTATION_STATUS.md`.
