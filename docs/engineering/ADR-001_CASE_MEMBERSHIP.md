# ADR-001 — Typed Case membership within Governance

**Status:** Proposed for review; implemented locally in P1-006  
**Date:** 2026-09-04  
**Owners:** Governance (membership/policy), Case (resource access), Workspace (eligibility)

## Context

P1-003/P1-004 used Workspace membership as an interim access boundary. P1-006
must prevent a Workspace member from reading another member's Case or its
Investigations. P1-005 already owns roles, assignments, and policy evaluation.

## Decision

- Governance assignments are the canonical membership record, marked
  `case_membership` and scoped to exactly one Case. Workspace-owned system roles
  are identified by `case_role`, not by a display name or generic permission.
- OWNER has Case read/update, Investigation read/create/update, and Case-scoped
  `GOVERNANCE_ROLE_MANAGE`. EDITOR has the same data operations without member
  administration. VIEWER has Case/Investigation read only.
- Case callers require typed membership through `PolicyEnforcer`, in addition
  to active Workspace membership. Generic Workspace, Case, exact-resource, and
  entity-discovery grants alone cannot satisfy this boundary. No role implies
  restricted identifier use/view, export, or cross-Case evidence access.
- Case creation provisions its OWNER in the same transaction. An idempotency
  replay reauthorizes and never recreates a revoked membership.
- Case/Investigation writes and membership commands share a per-Case transaction
  advisory lock; permission is reevaluated after acquiring it. Membership revokes
  are revision checked; removing the last active Case OWNER is forbidden.
  Generic assignment revocation cannot mutate typed Case membership.
- Case exposes checked add/remove application commands. Targets must be active
  Workspace members. Repeated same-role grants return the existing membership;
  changing role requires explicit revoke then grant. No new HTTP admin routes.
- Lists first obtain at most 101 permitted IDs from Governance, then fetch at
  most 100 Cases through Case's own repository. The cursor uses descending ID
  keyset pagination and is Workspace-bound; authorization is reevaluated per page.
  No runtime cross-module table/repository imports or joins are introduced.

## Alternatives considered

1. Separate Case membership table: straightforward ownership, but would duplicate
   assignment truth and require synchronization with Governance permissions.
2. Treat any generic Case/Workspace permission as membership: fewer schema fields,
   but broad grants could defeat confidentiality and blur explicit membership.
3. Filter a 100-row Case page in application memory: simpler query, but can hide
   accessible Cases behind unauthorized rows and produce incorrect pagination.

## Security and audit

Missing and denied Case/Investigation details share confidentiality-safe 404s.
Service identities cannot become user members. Active Workspace membership is
still checked on each request. Reads use current database authorization (no
permission cache); already-authorized in-flight reads are not cancelled by a
subsequent revoke. Mutation ordering is serialized with revocation.

Each runtime grant/revoke atomically appends history with actor, reason, and time,
plus `CASE_MEMBERSHIP_CHANGED` v1 Outbox intent. The payload contains only
`workspaceId`, `caseId`, `membershipId`, `historyId`, `action`, and `revision`.
It contains no user identity, reason, or Case content. Delivery/central audit
projection remains P1-008; classification-specific enforcement remains P1-007.

## Performance and consistency

Partial active-membership indexes support scope checks and bounded keyset pages.
Uniqueness permits one active membership per Case/user. Per-Case write locking
adds contention only within that Case; first-use role provisioning also serializes
on its Workspace. Cross-module read projections are identifiers, not duplicated
business state. No Case deletion or membership cache is introduced.

## Migration and operations

`governance/0002_case_membership.sql` is additive; applied `0001` files are unchanged.
Run the standard migration runner before starting the new API. For the one-time
legacy bootstrap only, the migration reads Case creators and active Workspace
members as a snapshot. It writes only Governance-owned tables. This explicit
migration dependency is not permission for runtime cross-module persistence access.

Existing active creators receive OWNER with UUIDv7 assignment/role/history IDs
and `LEGACY_CASE_CREATOR_BOOTSTRAP` history attributed to the migration service.
This backfill records history, not live membership-change Outbox events. Creators
who left the Workspace are not restored; affected Cases remain denied pending a
separately approved recovery workflow. Other Workspace members lose implicit Case
access. Review this access change and any orphaned Cases before deployment.

Future Workspace member removal must coordinate effective-owner invariants;
P1-006 protects the last active Case assignment, not every future Workspace
administration operation. No recovery/admin bypass endpoint is added here.

Database rollback must preserve membership/history data. Rolling the application
back below P1-006 would restore the old broader Workspace-only access policy and
is not a safe live rollback for confidential Cases; prefer a forward fix or
temporarily stop access. No production migration or deployment was performed.

## Consequences and compatibility

Existing Case/Investigation paths and ETag semantics remain. Case list adds
`page: { hasMore, nextCursor }` and an optional `cursor`; ordering changes from
update time to descending immutable ID. Clients must treat cursors as opaque.
During HTTP verification, raw SQL Case/Investigation timestamps were found to be
strings; persistence mapping now normalizes them to domain Dates before response
serialization. Workspace administration and the SHADOW membership UI are deferred.

## References

- `P1-006` in `docs/knowledge/20_DEVELOPMENT_BACKLOG_V1.md`
- `docs/knowledge/08_CROSS_CUTTING_ARCHITECTURE.md`
- `docs/knowledge/12_ARCHITECTURE_DECISIONS.md`
- `docs/contracts/platform-api-v1.yaml`
- `docs/engineering/P1_IMPLEMENTATION_STATUS.md`
