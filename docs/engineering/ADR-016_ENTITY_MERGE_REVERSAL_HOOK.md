# ADR-016 — Auditable Entity merge reversal hook

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Entity Registry backend; Audit owns the critical audit record

## Decision

Expose `POST /api/v1/entity-merges/{mergeId}/actions/reverse` as the only public
way to reverse a P2-011 Entity merge. The path identifies the immutable merge
decision. The request supplies current revisions for its survivor and absorbed
Entities plus a controlled correction reason. A single `If-Match` header cannot
guard two resources, so both revision preconditions are explicit body fields.

The operation requires a user principal, current `WORKSPACE_MANAGE` authorization
for both Entities, an `Idempotency-Key` and an `X-Audit-Operation-Id`. Missing and
inaccessible merge state shares a `404` boundary. Actor-scoped exact replay rechecks
authorization and returns the original immutable reversal decision.

One PostgreSQL transaction:

1. locks the Workspace merge topology and both Entity rows;
2. verifies the absorbed Entity is still `MERGED` directly into the recorded
   survivor and that both revisions are current;
3. increments the survivor revision without changing its lifecycle state;
4. restores the absorbed Entity to `ACTIVE`, clears its `mergedInto` pointer and
   increments its revision;
5. appends both Entity revision snapshots and an immutable reversal decision;
6. stores the idempotency record;
7. enqueues one metadata-only `ENTITY_MERGE_REVERSED` Outbox event; and
8. records the critical `ENTITY_MERGE_REVERSE` Audit authorization.

Failure of any Entity, history, reversal, Outbox or Audit write rolls back the whole
transaction. One unique reversal is permitted for each original merge decision.

## Bounded correction semantics

This hook removes only the direct merge edge recorded by P2-011. It never edits or
deletes the original `entity_merges` row. It also does not transfer or redistribute
aliases, protected identifiers, Case references, Knowledge, Evidence or source
records because the baseline merge did not move those records. The restored Entity
therefore resumes its own retained identity and history.

The direct-edge check rejects reversal after a later operation changes the absorbed
Entity's merge target. A survivor may have progressed to another valid lifecycle
state; reversal still detaches the recorded absorbed Entity while preserving that
survivor state. More complex split, redistribution and adjudication workflows need a
separate design and are not implied by this endpoint.

## Audit, replay and disclosure

Allowed correction reasons are `INCORRECT_IDENTITY_MATCH`,
`INSUFFICIENT_EVIDENCE`, `WRONG_SURVIVOR_SELECTED`, `DATA_CORRECTION` and
`MANUAL_REVIEW`. Free text is rejected. The Audit record links the operation to the
restored Entity revision. The Outbox event contains only reversal, merge, Workspace
and Entity IDs plus revisions; it excludes labels, aliases, identifiers, actor and
reason.

An exact retry with the same actor, idempotency key, command and audit operation ID
returns `201` and the original decision without duplicate revisions, Audit or Outbox
records. Reusing the key or operation ID for another command returns `409`. Stale
Entity revisions return `412`; an already-reversed merge or invalid current edge
returns `409`.

## Migration and rollback

Entity migration `0004` adds the append-only reversal and idempotency tables, their
foreign keys and history protections. Audit migration `0004` extends the controlled
action constraint. Apply both after the P2-011 migrations and before deploying the
API.

Rollback removes only the API build. Retain the additive schema, Entity revisions,
merge/reversal decisions, Audit records and Outbox events. Never delete or rewrite
history to simulate a rollback.

## Verification

Tests cover strict command parsing, domain revision and direct-edge invariants,
success and exact replay, user and Workspace authorization, missing and stale state,
concurrent reversal serialization, immutable decision/history records, canonical
resolution after restoration, metadata-only Outbox, critical Audit linkage and full
rollback when Audit persistence fails.

## References

- P2-012 in `docs/knowledge/20_DEVELOPMENT_BACKLOG_V1.md`
- [ADR-015 Entity merge baseline](ADR-015_ENTITY_MERGE_BASELINE.md)
- [ADR-003 Critical Audit baseline](ADR-003_CRITICAL_AUDIT_BASELINE.md)
- [ADR-008 Thin Entity Registry](ADR-008_THIN_ENTITY_REGISTRY.md)
- [Critical Audit v1](../contracts/critical-audit-v1.md)
