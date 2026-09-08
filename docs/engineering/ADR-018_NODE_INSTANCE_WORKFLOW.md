# ADR-018 — NodeInstance, InputBinding and WorkflowEdge inside an Investigation

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Workflow backend; Governance owns permissions

## Decision

A NodeInstance is Investigation-scoped configuration of one ACTIVE NodeDefinition
version. Creation resolves the parent Investigation first, then reuses
`CaseFacade.withAccess(caseId, "WORKFLOW_CREATE", ...)` — the same locked-transaction
authorization primitive Subject already composes on — and re-fetches the
Investigation a second time inside that lock, exactly like
`InvestigationFacade.update()` does, so a NodeInstance cannot be created against an
Investigation whose lifecycle is racing a concurrent Case/Investigation change. Only
an `ACTIVE` Investigation accepts new NodeInstances. `workspaceId`/`caseId` are
resolved from the Investigation, never accepted from the caller. The referenced
NodeDefinition must exist and be `ACTIVE` (404 if the key+version is unknown, 409
`NODE_DEFINITION_NOT_ACTIVE` if deprecated) before configuration is validated
against its `configSchema`: every required key present, every present key's runtime
type matching its declared `NodeFieldType`, unknown keys rejected outright.
NodeInstance creation is Idempotency-Key-required with the same replay/conflict
pattern as every other module.

Status starts `DRAFT`, or `READY` immediately when the NodeDefinition declares zero
required inputs. `POST /nodes/{nodeInstanceId}/input-bindings` **replaces** the full
binding set — not an append — and requires `If-Match` on the NodeInstance. Every
`targetInput` must name a NodeDefinition input with no duplicates, and `sourceType`
must equal that input's declared type; any violation is
`400 VALIDATION_INPUT_BINDING_INVALID` with nothing persisted, since validation runs
entirely in pure domain code before any repository call. This sourceType-must-match
rule is the literal P3-002 acceptance criterion. `sourceExpression` (e.g.
`"person.full_name"`) is recorded and type-checked structurally only; it is not
resolved or evaluated against a live resource in this slice — that is deferred to
future Execution/connector work. On success the facade recomputes `READY` iff every
required input is now bound, and the repository advances the revision under the same
compare-and-set guard used everywhere else.

`PATCH /nodes/{nodeInstanceId}` updates `configuration` only, re-validated against
the schema, requires `If-Match`, and is rejected once the NodeInstance is
`ARCHIVED` (terminal). `DELETE /nodes/{nodeInstanceId}` is a soft-archive — it sets
status to `ARCHIVED` and requires `If-Match` — never a real SQL `DELETE`, matching
this repository's no-destructive-delete convention everywhere else.

`POST /investigations/{investigationId}/workflow-edges` creates one directed edge
between two NodeInstances of the same Investigation/Case/Workspace. A self-loop, a
duplicate edge, either node missing from this Investigation, or an edge that would
create a cycle are all rejected; cycle detection is a BFS over the Investigation's
existing edges performed inside the same locked transaction immediately before
insert (`createsCycle()` asks whether the edge's target can already reach its
source).

An append-only `node_instance_revisions` table stores status, a SHA-256
configuration hash (never the raw configuration values), actor and time per
revision, protected by the same reject-UPDATE/DELETE trigger pattern
`subject_revisions` uses. Deviation from the request spec: a `GET
/nodes/{nodeInstanceId}` (embedding the current InputBinding set) was added beyond
the endpoints the backlog literally enumerated, because the If-Match/ETag
concurrency model used throughout this codebase is unusable without a way to read
the current revision first — every other resource in this repository has a paired
GET, and NodeInstance would be the sole exception without it. No list-by-
Investigation or list-edges endpoint was added; those remain a reasonable future
addition, not a requirement any P3-002 acceptance criterion depends on.

Governance gains `WORKFLOW_VIEW`, `WORKFLOW_CREATE`, `WORKFLOW_UPDATE`. OWNER/EDITOR
receive all three; VIEWER receives only `WORKFLOW_VIEW`, via the same additive
Governance migration pattern `0003_subject_permissions.sql` established (this task's
migration also carries the Run permissions from ADR-019 — see that ADR).

## Migration safety and rollout

`0002_create_node_instance.sql` is additive: `node_instances` (composite foreign key
into `node_definitions(key, version)`, plus foreign keys into
`workspaces`/`cases`/`investigations`), `node_instance_idempotency`,
`node_instance_input_bindings` (replaced wholesale by delete+insert inside one
transaction, never partially), `node_instance_revisions` with its append-only
trigger, and `workflow_edges` (a DB-level `CHECK` against self-loops and a `UNIQUE`
constraint against duplicate edges, as defense in depth alongside the domain-layer
check). `tooling/db/migrate.mjs`'s `ownerOrder` places `/modules/workflow/` directly
after `/modules/investigation/` so a fresh database resolves the cross-module
foreign keys correctly; `/modules/execution/` (ADR-019) is placed immediately after
it for the same reason. No existing table is altered by this migration.

## Verification

Unit tests cover: configuration schema validation (missing required key, unknown
key, type mismatch), readiness computation, ARCHIVED-is-terminal rejection, stale-
revision rejection, InputBinding targetInput/duplicate/type-mismatch rejection (the
literal P3-002 acceptance criterion), and WorkflowEdge self-loop/duplicate/cycle
rejection including a multi-hop indirect cycle. PostgreSQL/HTTP integration tests
(see `docs/engineering/P3_IMPLEMENTATION_STATUS.md` for real gate counts) cover
idempotent create replay and conflicting-hash 409, revision-mismatch 412,
Outbox-failure rollback, authorization denial for a non-member and for a VIEWER
attempting a write, cross-Case/Workspace isolation, and the NodeInstance-not-READY
block surfaced through Run creation (ADR-019).
