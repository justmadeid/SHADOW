# ADR-006 — Subject persistence before canonical identity resolution

Status: Proposed for review; implemented locally  
Date: 2026-09-07  
Owner: Subject backend; Governance owns permissions

## Decision

Ship the unresolved Subject API independently of Entity Registry. Subject is canonical
Case context, not a Person database. Public writes accept only type, role and optional
Investigation at creation, then one role update or archive per PATCH. Scope and type
are immutable in this baseline. Seeds belong to P2-002. No display name or identifier
is accepted, stored in history, logged or transported through the Outbox.

The domain models the future resolution lifecycle, but the database currently permits
only UNRESOLVED and ARCHIVED. Public entityRef is always null. Do not expose a
start-resolution or arbitrary status endpoint until P2-003/P2-008 can verify canonical
Entity linkage and commit it atomically with the human resolution decision. Expanding
the persistence schema is a later forward migration, not an application-only bypass.

Case-scoped SUBJECT_VIEW/CREATE/UPDATE permissions follow existing system roles:
OWNER/EDITOR can read/create/update; VIEWER only reads. Membership is required even
when an actor has a broad custom Workspace grant. Existing typed system roles receive
the same permissions through a Governance-owned migration; custom roles and membership
assignments are not changed. The migration is the versioned rollout record for this
capability extension, not a new actor-initiated grant.

CaseFacade.withAccess serializes Subject writes against Case lifecycle and membership
changes, rechecks access and supplies the enclosing transaction. Optional Investigation
scope is checked through its public facade under that same Case lock; only ACTIVE
branches accept new Subjects. Existing Subjects remain editable if a branch is later
paused/completed, but closed/archived Cases prohibit all Subject writes.

Subject, idempotency record, append-only revision history and minimal Outbox event are
committed together. Replays return the current record after reauthorization and parent
lifecycle validation. The actor-scoped key is protected by an advisory transaction
lock and a database primary key; a differing normalized payload returns 409.

Role and archive commands require a positive quoted revision. A compare-and-set SQL
write provides a second concurrency check. History stores role, status, actor and time
for every revision; scope/type remain on the immutable root. A trigger rejects history
UPDATE/DELETE. No destructive Subject deletion API exists. These ordinary context
operations do not pretend to be critical resolution Audit events; future identity
decisions must integrate the durable Audit facade.

Lists use descending immutable IDs, default 50/max 100, with a Workspace/Case-bound
cursor. Read authorization is reevaluated per request. Resource references grant no
cross-Case access. Subject metadata inherits Case access/classification obligations;
no independent downgrade or sensitive seed presentation is introduced.

## Migration safety and rollout

Apply the Subject and Governance migrations before deploying the API. Subject foreign
keys require Workspace, Case and Investigation tables. Canonical scope agreement is
enforced through application facades; individual foreign keys alone do not establish
matching Workspace/Case scope.

Governance migration 0003 replaces only the permission CHECK with a strict superset.
The safety marker permits this constraint replacement, not deletion of any table,
column or row. Both statements execute in the migration transaction. Existing values
remain valid. Review lock duration for large permission tables before production.
Old binaries can continue using their existing permissions during rollout.

Rollback the API build without removing records or reverting permission constraints.
No migration is executed on a user database by this development task. API/HTTP tests
use disposable PostgreSQL containers and synthetic authentication only.

## Verification

Cover real persistence, duplicate create, conflicting key reuse, revision races,
history protection, Outbox failure rollback, Case/Workspace isolation, VIEWER/EDITOR,
revocation, service-principal denial, invalid scope, bounded paging, mass assignment
and rejection of premature resolution. OpenAPI documents only implemented endpoints.
