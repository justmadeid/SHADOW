# P2 implementation status — Reusable Identity Core

## Baseline (2026-09-07)

P1-009 merged via PR #13 and P1-010 via PR #14. Synchronization PR #16 preserves
exactly the final P1-010 tree. Local main was fast-forwarded to a61d2fa at the user's
request. P2 contains P2-001 through P2-012 and targets M2 Reusable Identity Core.
Live Auth0 and production readiness remain operator gates, not inferred from merges.

## P2-001 — Subject context API implemented locally; resolution integration pending

Owner: backend Subject module. InvestigationSubject is canonical Case context,
not an Entity, Person profile, or seed-value store. P1-004 is present. Vocabulary
follows knowledge document 16; scope and rollout decisions are in
[ADR-006](ADR-006_SUBJECT_PERSISTENCE_BASELINE.md).

Implemented:

- Immutable domain snapshots, Subject type/role/lifecycle, revisions and UTC times.
- Domain resolver port requires a compatible canonical Entity in the same Workspace.
  Resolution failure does not mutate the input; archive preserves linkage.
- Registered Nest module with POST/GET /cases/{caseId}/subjects and
  GET/PATCH /subjects/{subjectId}. Creation accepts type, role, optional Investigation;
  PATCH accepts exactly one role or archive command with quoted If-Match.
- SUBJECT_VIEW/CREATE/UPDATE permissions via typed Case memberships. OWNER/EDITOR
  write; VIEWER reads. Service principals are denied. Absent and inaccessible Subject
  detail share SUBJECT_NOT_FOUND. Reads remain possible in closed/archived Cases;
  writes require a mutable Case. Optional Investigation must be active in that Case
  at creation. No UI/BFF mutation surface is added in this slice.
- Actor-scoped idempotent create, compare-and-set update, append-only revision history
  and minimal Outbox events in the Case access transaction. Replays reauthorize and
  return current data; conflicting request hash returns 409. No seeds/identifiers in
  request hashes or Outbox; only controlled enums and resource IDs.
- Stable-ID cursor pagination, default 50/max 100; cursor binds Workspace and Case.
- Two forward migrations: Subject tables/history and Governance permission extension.
  Existing typed Case roles are backfilled without changing custom roles/memberships.
  Historical migration files were not changed. Fresh-database migration order tested.
- OpenAPI and three Subject wire-contract tests added. No dependency/lockfile change.

### Remaining acceptance gate

P2-001 is not marked fully complete: real canonical Entity linkage requires P2-003
and the atomic resolution coordinator P2-008. Database and public API currently allow
only UNRESOLVED/ARCHIVED with entityRef null. There is no production resolver fallback,
no start-resolution endpoint, and no way to assign an arbitrary Entity via PATCH.
The future coordinator must persist human decision, verified linkage and critical
Audit atomically. Domain tests alone do not prove that future integration.

P2-002 owns SubjectSeed field provenance and is the next incremental task. P2-010
owns Add Target UI. Neither is included in this implementation.

## Validation (2026-09-07)

- Full m0:static passed: 181 unit tests, 9 contract tests, architecture (150 source
  files), 6 boundary tests, dependency graph, formatting, lint, typecheck, validation
  of 9 migrations, OpenAPI lint and all production builds.
- PostgreSQL/HTTP: 66 tests passed, including 9 new Subject tests covering concurrent
  replay, key conflict, revision races, role permissions, cross-scope denial,
  revocation, parent lifecycle, Investigation mismatch, paging, mass assignment,
  history protection, premature resolution denial and Outbox failure rollback.
- Test fixtures use disposable PostgreSQL and synthetic authentication. No user
  database migration, commit, push, PR or deployment was performed.

## Deployment and rollback

Review/apply migrations before deploying the API. Governance 0003 replaces a CHECK
with a strict superset and backfills system Case capabilities; ADR-006 documents the
safety-marker rationale and table-lock consideration. Roll back the API build only;
retain Subject history/data and additive permissions. No destructive data rollback.
