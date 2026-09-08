# ADR-015 — Auditable Entity survivor merge baseline

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Entity Registry backend; Audit owns the critical audit record

## Decision

Expose `POST /api/v1/entities/{survivorEntityId}/actions/merge` as the only public
way to create Entity merge state. The command explicitly names one active survivor
and one active absorbed Entity. Both must be distinct, share one Workspace and type,
and pass independent optimistic revision checks. The survivor revision is supplied
by `If-Match`; the absorbed revision is a required body field.

The operation requires a user principal, current `WORKSPACE_MANAGE` authorization
for both Entity resources, an `Idempotency-Key`, a controlled reason code and an
`X-Audit-Operation-Id`. A Workspace-scoped advisory lock serializes merge topology
changes and deterministic row locking prevents merge races. Actor-scoped replay
rechecks authorization and returns the immutable original decision; reuse with a
different command conflicts.

One transaction:

1. increments and records the survivor revision while keeping it `ACTIVE`;
2. increments the absorbed revision and marks it `MERGED` with `mergedInto` pointing
   to the survivor;
3. persists an append-only `entity_merges` decision containing both before/after
   revisions, the controlled reason and operation identity;
4. stores the idempotency record;
5. emits one metadata-only `ENTITY_MERGED` Outbox event; and
6. records the critical `ENTITY_MERGE` Audit authorization.

Failure of Entity history, merge decision, Outbox or Audit rolls back every effect.
The Outbox contains only merge, Workspace and Entity IDs plus revisions. Canonical
labels, aliases, identifiers, actor and reason never enter the event payload.

## History and canonical resolution

Neither Entity nor any alias, identifier, Case reference or Knowledge record is
deleted or reassigned. The absorbed Entity remains readable according to normal
Workspace policy, retains its identity history, and resolves through the bounded
canonical resolver to the active survivor. The survivor's label is authoritative;
the command does not silently promote an absorbed label or source attribute.

Repeated survivor merges can form a chain for historical IDs. Resolution remains
bounded at fifteen edges. A merge that would exceed that bound is rejected before
mutation; an index on `merged_into_id` supports the bounded predecessor check. Active
survivor requirements prevent application-created cycles.

## Correction hook

The immutable merge decision deliberately stores survivor/absorbed IDs, operation
identity, both before/after revisions, reason, actor and timestamp. P2-012 implements
the bounded correction hook against this artifact in
[ADR-016](ADR-016_ENTITY_MERGE_REVERSAL_HOOK.md). Neither operation edits merge
history or performs complex data redistribution.

## API and error semantics

The successful or replayed command returns `201` with the immutable merge decision
and an ETag for the survivor revision. Missing/inaccessible or cross-Workspace
resources share the Entity `404` boundary. Self, incompatible type, inactive state,
operation-ID reuse and chain-limit violations return `409`; stale survivor or
absorbed revisions return `412`. Audit durability failure is sanitized as `503`.

## Migration and rollback

Entity migration `0003` adds the merge artifact, idempotency table, lookup indexes
and mutation-blocking triggers. Audit migration `0003` adds the controlled action.
Apply all migrations before deploying the API. Old binaries ignore the additive
tables and continue resolving existing `MERGED` rows. Application rollback must
retain merge and Audit history; no down migration or destructive cleanup is allowed.

## Verification

Tests cover domain status/scope/type/revision invariants, strict request fields,
successful and replayed HTTP commands, operation conflicts, hidden cross-Workspace
and unauthorized access, user-only execution, immutable decision/revision history,
metadata-only Outbox, durable Audit linkage, canonical legacy-ID resolution, chain
bounds and complete rollback when Audit fails.

## References

- P2-011 in `docs/knowledge/20_DEVELOPMENT_BACKLOG_V1.md`
- `docs/knowledge/05_ENTITY_KNOWLEDGE_MODEL.md`
- [ADR-003 Critical Audit baseline](ADR-003_CRITICAL_AUDIT_BASELINE.md)
- [ADR-008 Thin Entity Registry](ADR-008_THIN_ENTITY_REGISTRY.md)
- [Critical Audit v1](../contracts/critical-audit-v1.md)
