# ADR-021 — ExecutionPlan: immutable worker-facing contract, structurally secret-free

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Execution backend; depends on P3-003 (Run) and P3-004 (ExecutionAttempt)

## Decision

`ExecutionPlan` (`execution/domain/execution-plan.ts`) is the immutable,
minimal contract a future worker (P3-007) reads to actually execute a Run,
shaped exactly per `docs/knowledge/07_WORKFLOW_EXECUTION_CONNECTORS.md` §10:
`runId, attempt context, capability, connectorId/version, input, limits,
accessContext, checkpoint`. It is composed, never persisted, by
`composeExecutionPlan(run, attempt, definition)` from three already-durable
sources: the Run row, its currently active ExecutionAttempt, and the pinned
`NodeDefinition` resolved via `NodeDefinitionFacade.findByKeyVersion` (public
through `WorkflowModule`'s existing export — no new cross-module surface was
needed).

`GET /internal/v1/runs/{runId}/execution-plan` requires only
`requireServiceId()` — the same trust boundary as every other endpoint in
this task — and requires the Run to currently have an active (LEASED/RUNNING,
unexpired) Attempt, else `409 RUN_EXECUTION_PLAN_NOT_AVAILABLE`: a plan is
only meaningful once a worker has actually leased an attempt to run, not for
a Run merely sitting `QUEUED`. `capability` and `limits.timeoutSeconds` are
read fresh from the pinned NodeDefinition at plan-build time rather than
copied into a frozen snapshot anywhere: this is safe because a given
key+version's NodeDefinition row is immutable for its lifetime by
construction (P3-001's registry rejects a shape-changing re-registration of
an existing key+version with `409 CONFLICT_NODE_DEFINITION_KEY_VERSION_REUSED`),
so resolving it fresh is equivalent to a frozen snapshot without needing to
duplicate NodeDefinition data onto the Run or Attempt row. If the pinned
NodeDefinition cannot be resolved at all, that is treated as a genuine
internal invariant violation (`500 EXECUTION_PLAN_NODE_DEFINITION_MISSING`),
not a 404 — a Run always pins an existing NodeDefinition at creation time and
NodeDefinition rows are never deleted, so this should never actually happen.
`input` is exactly `Run.inputSnapshot`, re-exposed unchanged (already frozen
by `createRun`).

`connector` is **always `null`** in this slice. Source Registry/connector
resolution (`ConnectorDefinition`, capability-to-connector selection) is
P4-001+ and does not exist anywhere in this repository yet; the field is
typed `{ connectorId: string; version: number } | null` so a real future
value fits without a breaking type or contract change, but nothing in this
slice ever populates it. `checkpoint` is **always `null`** for the same
reason with respect to P3-009 (checkpoint/resume), which is explicitly out of
scope; `PUT /internal/v1/runs/{runId}/checkpoint` is not implemented.

The literal P3-005 acceptance criterion — "no plain secrets or unrestricted
DB objects in plan" — is proven structurally, not just by review.
`assertExecutionPlanIsSecretFree` (same file) recursively walks every key of
a composed plan and throws `500 EXECUTION_PLAN_SENSITIVE_FIELD_FORBIDDEN` if
any key matches `/secret/i`, `/api[_-]?key/i`, `/token/i`, `/credential/i`, or
`/password/i` — in spirit the same recursive-key-walk technique
`outbox-payload-policy.ts`'s `assertSafeOutboxPayload` already uses for
Outbox payloads, scoped to the ExecutionPlan shape specifically.
`composeExecutionPlan` calls this guard itself before returning, and the
facade calls it again defensively before returning the plan over HTTP. A
dedicated unit test (`execution-plan.spec.ts`) both calls the guard directly
against a real composed plan and independently walks the plan's
`JSON.stringify`d keys with its own forbidden-substring list, then proves the
guard actually rejects a tainted plan carrying an `apiKey`-shaped key. There
is no `DB objects` concern to separately guard against beyond the secret-key
check: `ExecutionPlan` never carries a raw database row, connection string,
or unrestricted query object anywhere in its shape — `input` is the already-
sanitized `RunInputSnapshot` (typed `configuration`/`InputBinding[]`, not a
live DB handle), and `accessContext` is four scoping IDs, never a credential
or session token.

## Verification

Unit tests (`execution-plan.spec.ts`) cover: `composeExecutionPlan` producing
`connector: null`/`checkpoint: null` always, `capability`/`limits` sourced
from the NodeDefinition, `input`/`accessContext` sourced from the Run, and the
literal secret-free acceptance criterion via both the structural guard and an
independent key walk. PostgreSQL/HTTP integration tests cover
`RUN_EXECUTION_PLAN_NOT_AVAILABLE` before any Attempt exists, a `200` plan
once one does (asserting `connector`/`checkpoint` are `null` and the response
body contains no secret-shaped key), and reuse of the same `requireServiceId`
authorization path as ExecutionAttempt's endpoints.
