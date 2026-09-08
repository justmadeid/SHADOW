# ADR-014 — Target Profile View composition

**Status:** Accepted

**Date:** 2026-09-08

**Owner:** Target Profile application query layer

**Dependencies:** P2-001 Subject, P2-003/P2-004 Entity Registry and Identifier,
P2-008 atomic resolution

## Decision

P2-009 exposes:

```text
GET /api/v1/shadow/cases/{caseId}/targets/{subjectId}
```

The route is bound to both the current Case and InvestigationSubject. This refines
the older experience-query skeleton that identified a profile only by `entityId`.
An Entity-only route cannot represent an unresolved Subject and cannot prove which
Case context may be disclosed. It also does not match the approved SHADOW product
route `/shadow/cases/:caseId/targets/:subjectId`.

`TargetProfileView` is composed at request time through public Subject and Entity
facades. The query does not own or write a Person/Profile table. Its canonical inputs
are:

- current Case-scoped `InvestigationSubject`;
- its canonical active Workspace `Entity`, when resolved;
- active `EntityIdentifier` metadata rendered as fixed-mask values.

The Subject is authorized with `SUBJECT_VIEW` before any Entity or Identifier is
loaded. The path `caseId`, Subject `caseId`, Workspace scope and canonical Entity
chain must agree. Missing, mismatched and inaccessible profiles use the same
`TARGET_PROFILE_NOT_FOUND` response. Responses are `private, no-store`.
The exact linked identity is available through trusted facade composition after Case
authorization; broad Workspace registry discovery permission is not implicitly
granted and remains required on the standalone Entity endpoints.

Workspace Knowledge, source coverage, account, Evidence, discovery, review and
search domains are not implemented in P2-009. Their fields remain empty with
`NOT_IMPLEMENTED` availability and nullable totals; the API does not fabricate zero
results or infer facts from Candidate/source output. Future owners will replace each
placeholder through a facade contract.

Freshness is explicit. This baseline reads canonical PostgreSQL data directly, so it
returns `mode=CANONICAL`, source revisions/timestamps and `isStale=false`.
Projection freshness remains owned by P10-007.

## Security and audit

The aggregate query never requests raw Identifier disclosure. Identifier collection
values remain `MASKED` with the fixed display value `••••`; revoked identifiers are
excluded. Seed values, encrypted material, fingerprints, other Case context and raw
source payloads are absent.

No durable audit event is added because P2-009 performs an ordinary authorized read
and releases neither `FULL` nor `MATCH_ONLY` protected data. Existing audited detail
endpoints remain the only path for stronger Identifier visibility.

## Persistence and rollback

P2-009 adds no migration, projection, event or Outbox write. Rollback consists of
removing the query module and route; canonical data is unaffected.
