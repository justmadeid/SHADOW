# ADR-003 — Critical audit baseline

**Status:** Proposed for review; implemented locally in P1-008  
**Date:** 2026-09-04  
**Owners:** Audit (canonical evidence), Governance (authorization and membership)

## Context

P1-006 changes Case access transactionally but its Governance history is not a
general Audit store. P1-007 reports durable-audit obligations without executing
sensitive operations. P1-008 requires that a critical business action cannot
commit while its required audit intent is lost. Observability logs and a direct
queue publish do not satisfy that invariant.

## Decision

- Audit owns the append-only PostgreSQL `audit_events` table and exposes only
  `AuditFacade.record` through its public module boundary. It requires the caller's
  active business transaction and an authenticated USER or SERVICE principal.
- Case creator OWNER initialization, membership grant, and membership revocation
  write Governance state/history, domain Outbox, canonical Audit, and Audit Outbox
  in the same transaction. Membership history ID is the audit operation ID.
  Same-role no-op grants and Case idempotency replay do not emit duplicate audit.
- Any Audit validation or persistence failure marks the enclosing transaction
  rollback-only. Catching the exception does not permit an outer commit. Database
  and Outbox failures return a sanitized `503 AUDIT_DURABILITY_FAILED` without SQL,
  bound parameters, or an underlying error cause that could leak protected data.
- Database triggers reject UPDATE, DELETE, and TRUNCATE, including statement-level
  attempts. No cascading domain foreign keys can delete the historical references.
- Canonical actor and correlation come from RequestContext, never audit input.
  Input has bounded typed fields, no arbitrary metadata or raw-value channel.
  Actor/reason remain protected canonical data; Outbox carries references only.
- Deduplication key is `(workspaceId, operationId, action, outcome)`. Identical
  retries return the original ID without another Outbox event. Different canonical
  actor, resource, reason, classification, membership, or revision yields
  `409 AUDIT_OPERATION_CONFLICT`; original correlation/time are retained.

### Sensitive release boundary

Governance exposes `AuditedDataAccess.display`, `authorizeExport`, and
`authorizeSource` on top of the P1-007 planning policy. They own their transaction
and reject an ambient transaction: an inner callback must not return protected
data or an authorization while an outer transaction can still roll back.

For Case-scoped operations they acquire the same membership lock as P1-006, then
evaluate current permissions. The owning domain must first resolve canonical
resource scope/classification, active Workspace eligibility and source policy;
these inputs must never be copied unverified from HTTP JSON. This baseline does
not provide generic Workspace-revocation locking or a new domain lookup service.

Sensitive FULL/MATCH_ONLY requires canonical audit plus its Outbox intent before
the loader runs. Loader execution is limited to local data reads/computation, not
external calls or disclosure; FULL loads a value, MATCH_ONLY should compute only
the match. MASKED/HIDDEN never invokes the loader. The safe presenter returns only
the permitted fields after transaction commit. Loading/presentation failure is
sanitized and rolls back; no result is released. HIDDEN sensitive requests persist
a DENIED event; default masking itself does not require a disclosure event.

Export/source decisions persist AUTHORIZED or DENIED, including disabled-policy
denials. They do **not** claim an export was generated, a connector ran, a client
received data, or a redaction completed. Future executors must recheck access at
execution, enforce all handling obligations, and record execution outcomes in
their own slice. Audit IDs are not bearer capabilities. Retry uses the same ID
only for the same logical operation, re-evaluates current policy first, and can
record a new DENIED outcome after revocation without rewriting prior evidence.

`ClassificationPolicy` remains a pure planning API; its allowed decision or
`requiresDurableAudit` flag alone never satisfies an execution/disclosure boundary.
The pure presenter likewise cannot prove an audit was committed.

## Alternatives considered

- Async queue/log-only audit: lower request latency but a crash or publish failure
  can leave a committed action without durable evidence; rejected.
- Independent audit transaction for membership: audit can survive a rolled-back
  action or fail after an action commits; rejected for successful domain changes.
- Arbitrary JSON audit payloads: flexible but an uncontrolled sensitive-data
  channel; rejected in favor of versioned fields and canonical references.
- Immediate external immutable storage: stronger operational separation but new
  deployment/retention dependencies; deferred beyond this PostgreSQL baseline.

## Security implications

Audit is not Observability. Logs, metrics, and queues must not contain actor IDs,
reasons, identifier values, tokens, or raw source payloads from Audit. No audit
query endpoint, broad read API, new secret, permission grant, source egress, or
product-name policy branch is added. Authenticated context remains mandatory.

Append-only triggers protect ordinary SQL writes, not a malicious database owner
or superuser capable of disabling triggers or changing DDL. Deployment must use a
separate migration owner and least-privilege runtime role without superuser,
ownership, TRUNCATE, UPDATE/DELETE on Audit, or trigger/DDL bypass privileges.
Role provisioning and external tamper-evident archival are not implemented here.

The protected reason field may itself contain personal data; operators should
use minimal justification. This is not a claim that the canonical Audit DB is
PII-free. No copy of that text is placed in Outbox, errors, or a hash-input column.

## Performance implications

Each critical transition adds one canonical insert and one transactional Outbox
insert. Duplicate retries add a keyed lookup. Workspace/Case time indexes support
future authorized audit reads; no unbounded query endpoint is exposed. Audit
storage grows monotonically. Case locking serializes sensitive access with
membership changes; loaders must be short, bounded, and never wait for network
services while holding that lock. A future batch-read design must preserve the
same commit boundary and data minimization.

## Data/provenance and compatibility

The new migration creates a seventh additive migration unit; applied migrations
are unchanged. Its `migration-safety: allow-destructive ADR-003` marker handles
the lexical safety gate's TRUNCATE false positive: it **creates a trigger blocking
TRUNCATE**, not a data deletion. No existing record is modified or backfilled.
Pre-rollout membership history remains Governance history; do not fabricate old
Audit events or claim historical Audit coverage.

Coverage starts with runtime Case membership and the new sensitive-access wrapper.
Internal P1-005 generic role/assignment provisioning and direct operator SQL are
not retroactively wrapped. Future admin command surfaces must adopt critical Audit
before exposure; Case metadata/classification updates and all possible sensitive
domain operations are not globally intercepted by this slice.

Public HTTP remains unchanged except the documented Case-create 503 failure.
Internal event contract: [critical-audit-v1](../contracts/critical-audit-v1.md).

## Operational implications

Apply the new migration via the existing migration runner **before** starting the
new API build. A missing Audit table fails critical commands closed. Canonical
Audit does not wait for broker delivery: the committed Outbox intent can retry
using the existing dispatcher. Audit delivery failure must not delete the canonical
row. There is no new audit consumer/read model in this slice.

Retain Audit data on application rollback; no down migration deletes evidence.
Rolling back to a pre-Audit build removes this coverage, so suspend critical writes
or use a forward fix rather than silently operating without audit. Retention,
legal hold, controlled archival and authorized read/export are future work; no
purge mechanism is added. Existing log/error handling receives only sanitized
Audit failures; monitoring may count codes/latency without copying event content.

## Consequences and evidence

Critical membership changes fail closed, with extra database latency and storage.
Audited disclosure is explicit, not a global response interceptor. New domain
owners must use the correct facade and resolve their own trusted scope. Tests
exercise real PostgreSQL atomicity, rollback-only caught failures, immutable
triggers, deduplication, actor attribution, disclosure commit timing, and
revocation. Full validation results are in [P1 status](P1_IMPLEMENTATION_STATUS.md).

## References

- P0-007 and P1-008 in `docs/knowledge/20_DEVELOPMENT_BACKLOG_V1.md`
- `docs/knowledge/08_CROSS_CUTTING_ARCHITECTURE.md`
- `docs/knowledge/34_DATA_CLASSIFICATION_HANDLING_MATRIX.md`
- [ADR-001 Case membership](ADR-001_CASE_MEMBERSHIP.md)
- [ADR-002 Classification hooks](ADR-002_CLASSIFICATION_POLICY_HOOKS.md)
