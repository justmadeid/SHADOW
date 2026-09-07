# ADR-012 — Governance-aware Workspace Entity match query

**Status:** Accepted for P2-007 implementation (2026-09-08)

**Owners:** Resolution query/presentation and Entity Registry protected comparison

**Dependencies:** P2-003 Entity Registry, P2-006 matching signals, P1-006 Governance

## Decision

P2-007 exposes `GET /api/v1/resolutions/{resolutionId}/matches` as a bounded view of
immutable P2-006 match snapshots. Resolution owns the public response and verifies
current Subject access. Entity Registry remains the canonical source for Entity state
and protected Identifier comparison. Resolution calls only Entity's public facades;
neither module reads the other's repository or tables.

The public view contains match ID, Candidate ID, Entity reference, controlled match
level, controlled signal metadata, a minimal cross-Case capability marker and creation
time. It never contains an Entity label, another Case ID/name, Evidence, Finding,
source payload, raw/masked identifier, comparison fingerprint, numeric score,
classification or free-text rationale.

## Authorization and cross-Case behavior

The caller must first retain `SUBJECT_VIEW` for the Resolution's Case and then have
`DISCOVER_ENTITY_EXISTENCE` in that Case context. A caller without Subject access gets
the existing indistinguishable `RESOLUTION_NOT_FOUND`; a visible Resolution without
discovery permission gets `ACCESS_DENIED` before match rows are read.

SENSITIVE and RESTRICTED signals are filtered in the repository before pagination and
again in the domain presenter. They are returned only when the caller currently has
`IDENTIFIER_USE_RESTRICTED` and supplies both a controlled reason and stable audit
operation UUID. Without that complete authorization context, public/internal signals
may still be returned but protected-only matches do not affect the visible page.

`VIEW_CROSS_CASE_CONTEXT` controls only `crossCaseContext.detailsVisible`. P2-007 does
not return cross-Case details even when the value is true. `exists` states only that
the already-disclosed Workspace Entity exists; it does not state that another Case
references it.

## Protected exact comparison and audit

Entity Registry provides a non-HTTP exact-match port. It verifies the real accessible
Case/Workspace pair, `DISCOVER_ENTITY_EXISTENCE`, `IDENTIFIER_USE_RESTRICTED`, reason
and audit operation ID before querying. The normalized input exists only in process
memory. Persistence computes the existing domain-separated Workspace/type keyed HMAC
and compares it against active Identifier fingerprints. Only safe Entity metadata and
classification return to trusted application code.

Every authorized protected comparison and every protected MATCH_ONLY page disclosure records a
durable `SENSITIVE_FIELD_MATCH` audit event in the same short transaction. Audit and
Outbox failure prevents release of the result. Audit resource is the current Case and
contains no identifier, fingerprint, Entity match detail or arbitrary metadata.

## Performance, deployment and rollback

Match pages use stable UUID pagination bound to Resolution, Workspace and Case, with a
default of 50 and maximum of 100. Eligibility is applied before `LIMIT`, so hidden
protected-only rows do not distort visible pagination. Entity canonical-state checks
use bounded batch resolution rather than one query per match. Existing Identifier
fingerprint uniqueness supplies the exact-match index path.

P2-007 adds no migration, mutation endpoint or new event. Deploy the API after the
existing P2-004 and P2-006 migrations. Rollback is the prior API build; immutable match
and audit history remains intact. P2-008 retains sole ownership of human resolution,
Entity creation/linking and Subject mutation.
