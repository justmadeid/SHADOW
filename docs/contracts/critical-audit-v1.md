# Critical Audit v1 — internal contract

Owner: Audit. Introduced in P1-008. No public HTTP audit read/write API exists.
Canonical records are protected PostgreSQL data, not general log payloads.

## Canonical record

| Field | Meaning |
| --- | --- |
| `id`, `version` | Server UUIDv7; schema version 1 |
| `operationId` | UUID for one logical operation; membership uses its history ID |
| `action`, `outcome` | Allowlisted pair below |
| `workspaceId`, `caseId` | Canonical Workspace UUID and optional Case UUID |
| `resourceType`, `resourceId` | WORKSPACE/CASE/INVESTIGATION/ENTITY/EVIDENCE/IDENTIFIER/EXPORT/GOVERNANCE and UUID; CASE requires matching `caseId` |
| `actorType`, `actorId` | Verified USER or SERVICE from RequestContext; ID bounded to 255 characters |
| `requestId`, `traceId` | Trusted request context; nonempty, at most 128 characters each |
| `reason` | Optional protected justification, nonblank and at most 1000 characters when present |
| `classification` | Required for sensitive field/export/source authorization records; optional on membership |
| `membershipId`, `resourceRevision` | Membership UUID and positive revision required on membership transitions; no membership ID on other actions |
| `occurredAt` | Server timestamp |

No caller-supplied actor, arbitrary metadata, raw field/source payload, or tokens.
Other actions may supply a positive resource revision. These are trusted server
inputs; resource ownership and authorization are enforced by the domain caller,
not by `AuditFacade.record` itself.

| Action | Outcomes | Required justification |
| --- | --- | --- |
| `CASE_MEMBERSHIP_GRANTED` | SUCCEEDED | Yes; creator initialization uses `CASE_CREATED` |
| `CASE_MEMBERSHIP_REVOKED` | SUCCEEDED | Yes |
| `SENSITIVE_FIELD_VIEW` | AUTHORIZED, DENIED | Yes for AUTHORIZED |
| `SENSITIVE_FIELD_MATCH` | AUTHORIZED, DENIED | Yes for AUTHORIZED |
| `EVIDENCE_EXPORT_AUTHORIZATION` | AUTHORIZED, DENIED | Yes for AUTHORIZED |
| `SOURCE_ACCESS_AUTHORIZATION` | AUTHORIZED, DENIED | Yes for RESTRICTED AUTHORIZED |

Missing reason on a denied attempt does not prevent recording the denial.
AUTHORIZED means permission/intent, not delivery or external execution. Current
hidden field denials use VIEW; the wrapper only selects MATCH after use-only
authorization. Masked values are fixed placeholders and do not load source values.

## Transaction and retry semantics

`AuditFacade.record` must join a business transaction. State changes, canonical
Audit and durable Outbox commit atomically. Audit errors mark the transaction
rollback-only even when callers catch them. Stable errors:

- `AUDIT_TRANSACTION_REQUIRED` (500): missing business transaction.
- `AUDIT_ACTOR_REQUIRED` (403): no authenticated principal.
- `AUDIT_INPUT_INVALID` (400): invalid typed input/context, no reflected content.
- `AUDIT_OPERATION_CONFLICT` (409): duplicate operation identity with changed content.
- `AUDIT_DURABILITY_FAILED` (503): canonical/Outbox persistence failed; no raw cause.

Same `(workspaceId, operationId, action, outcome)` and canonical content returns
the original audit ID, retaining original timestamp/correlation and producing no
second Outbox event. Changed actor/resource/reason/classification/membership/revision
conflicts. A new logical operation requires a new ID. Deduplication never caches an
authorization; retry re-evaluates current policy, and a subsequent denial may have
its own record. Records cannot be updated, deleted, or truncated by ordinary DML.

`AuditedDataAccess` owns its commit boundary, rejecting ambient transactions with
`AUDIT_RELEASE_BOUNDARY_REQUIRED` (500). Display loads only FULL/MATCH_ONLY, then
returns the safe classified-field response after commit. Loader/presentation
failure returns `AUDIT_DISCLOSURE_LOAD_FAILED` (503) without a raw cause. Export
and source methods return policy decisions plus `auditEventId` after commit,
including denials. IDs are references, not authorization tokens. This contract
adds no connector calls, object-store effects, or exporter implementation.

## Durable event notification

- Event type: `AUDIT_EVENT_RECORDED`, version: `1`.
- Aggregate: `{ type: "AUDIT_EVENT", id: "<audit UUID>" }`.
- Payload **only**: `{ auditEventId: "<audit UUID>", workspaceId: "<Workspace UUID>" }`.
- Envelope uses existing Outbox event ID, occurredAt, requestId and optional traceParent.
- Delivery uses the existing at-least-once dispatcher/retry contract. A future
  consumer must deduplicate by event/audit ID and use an authorized Audit read
  boundary; it must not copy protected actor/reason into queues or logs.

No actor, reason, classification, identifier value, or raw source content is
included in the notification. Canonical Audit remains authoritative even if
delivery is delayed. See [ADR-003](../engineering/ADR-003_CRITICAL_AUDIT_BASELINE.md)
for coverage limits, deployment and retention constraints.
