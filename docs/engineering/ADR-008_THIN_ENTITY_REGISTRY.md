# ADR-008 — Thin Workspace Entity Registry baseline

Status: Proposed for review; implemented locally  
Date: 2026-09-07  
Owner: Entity Registry backend; Governance owns access decisions

## Decision

Represent reusable Workspace identity with a dedicated Entity aggregate containing
only stable ID, Workspace scope, controlled type, canonical label, aliases, lifecycle
status, optional merge target and revision metadata. Entity does not contain Case ID,
Subject role, allegations, employer, address, Evidence, Findings, Claims,
Relationships, source payloads or other investigative interpretation.

The initial public surface provides Workspace-scoped list/create and Entity detail/
update. Full Registry reads require both active Workspace membership and a persisted
WORKSPACE_VIEW grant. Manual create, rename, alias addition and archive require active
membership plus WORKSPACE_MANAGE. No default Registry grant is inferred from mere
membership. Absent and inaccessible detail use the same ENTITY_NOT_FOUND response.

Direct POST is a restricted manual curation/import path, not the normal identity
creation flow. Candidate Resolution remains responsible for normal Entity creation in
P2-008. P2-007 owns the separate possible-match query and cross-Case existence
disclosure policy; the baseline list endpoint never returns Case context.

Entity type and Workspace are immutable. Canonical labels and aliases are normalized
with NFKC, bounded and control-character free. Alias equality is case-insensitive.
Renaming retains the previous canonical label as an append-only alias; adding an
existing/canonical alias conflicts. Archive is terminal in this slice. The schema can
represent MERGED and the trusted resolver follows a bounded merge chain, but public
merge mutation is prohibited until P2-011 can persist the critical Audit decision and
survivor semantics atomically.

Writes use optimistic revision checks. Creation is actor/idempotency-key serialized;
replay compares the immutable revision-one label/type and revision-one aliases instead
of storing a guessable identity digest. Entity, aliases, replay record, revision and a
metadata-only Outbox event commit together. Outbox events contain only resource IDs,
status and revision—never canonical labels or aliases.

Identifiers are explicitly excluded. P2-004 owns protected value encryption, masked
presentation and keyed comparison fingerprints. Entity aliases are names, not an
escape hatch for email, phone, national ID or arbitrary identifier storage.

## Migration safety and rollout

Apply Entity Registry migration 0001 after Workspace storage and before deploying the
API. It adds Entity, alias, revision and idempotency tables plus query indexes and
append-only triggers for aliases/history. No existing table or row is changed. The
migration runner explicitly orders the Entity owner after Workspace.

Old binaries ignore the additive tables. Roll back the API build without deleting
Registry data or removing append-only protection. This development task does not
migrate a user database.

## Verification

Cover normalization and deep immutability, identity-only input boundaries, alias
preservation, terminal archive, stale revisions, actor-scoped replay conflicts,
Workspace isolation, separate view/manage grants, membership revocation, hidden
existence, stable pagination, active/merged canonical resolution, append-only rows,
metadata-only Outbox events and complete transaction rollback when Outbox insertion
fails.
