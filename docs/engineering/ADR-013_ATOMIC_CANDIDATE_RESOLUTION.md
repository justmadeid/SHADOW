# ADR-013 — Atomic Candidate resolution coordinator

**Status:** Accepted for P2-008 implementation (2026-09-08)

**Owner:** Resolution application coordinator

**Dependencies:** P2-001 Subject, P2-003 Entity Registry, P2-005 Candidate,
P1-008 Audit and Outbox

## Decision

Resolution owns `POST /api/v1/subjects/{subjectId}/actions/start-resolution` and
`POST /api/v1/candidates/{candidateId}/actions/resolve`. It coordinates through
public Subject and Entity facades; it does not import either module's repository or
tables. The owning Case is authorized and locked before resolution writes.

Starting requires `SUBJECT_UPDATE`, a mutable Case, Subject `If-Match` and an
`Idempotency-Key`. Session creation and the Subject `RESOLVING` transition share one
transaction. Candidate decisions require Candidate `If-Match`, `Idempotency-Key` and
`X-Audit-Operation-Id`. The idempotency request hash contains only controlled enums,
resource IDs and revisions.

`LINK_EXISTING` locks and resolves merged chains and requires an active compatible
Entity in the same Workspace through commit. `CREATE_NEW` derives type and canonical
label from the persisted Candidate and uses a private namespaced Entity idempotency
key. It is prohibited for RESTRICTED Candidates because their fixed display label is
deliberately not identity. The HTTP caller cannot submit a canonical label or directly
assign a Subject Entity.

`REJECT` and `UNCERTAIN` leave the Subject `RESOLVING` while another pending Candidate
exists. The final non-conclusive decision closes the session and marks the Subject
`RESOLUTION_FAILED`. A conclusive decision resolves both session and Subject.

## Atomicity and invariants

One database transaction commits the decision, Candidate/session revisions, optional
Entity create/link, Subject transition, append-only histories, durable
`CANDIDATE_RESOLUTION` audit against the Candidate resource and metadata-only Outbox
events. Any failure rolls all of them back. An advisory transaction lock serializes
retries by actor and idempotency key; replay is checked before final-state validation
and returns the original result.

Forward migrations extend Subject lifecycle/link persistence, add Workspace-scoped
Entity foreign keys to Subject and decisions, register the audit action, and add the
decision replay table. Database shape checks prohibit a `RESOLVED` Subject without an
Entity and prohibit unresolved states with an Entity. Existing history remains
append-only.

## Deployment and rollback

Apply Audit 0002, Subject 0003 and Resolution 0003 before the new API build. These
migrations add strict-superset lifecycle values, nullable/backfilled columns,
constraints and new tables; no data is deleted. Roll back the API build only and keep
the forward schema and immutable histories. Older binaries continue to use their
existing columns and lifecycle paths.
