# ADR-011 — Explainable matching signals and field visibility

**Status:** Accepted for P2-006 implementation (2026-09-08)

**Owner:** Resolution backend domain

**Dependencies:** P2-004 secure Identifier storage, P2-005 Resolution/Candidate

## Decision

Resolution owns immutable `EntityMatch` snapshots, `MatchingSignal` and
`ConflictSignal`. A snapshot pins Candidate and Entity revisions and contains only
controlled explanation metadata: field, result, strength, classification and value
visibility. It contains no raw or masked identity value, comparison fingerprint,
numeric score, source payload or free-text rationale.

Search relevance remains distinct from identity confidence. `matchLevel` is a
controlled review classification (`LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH`), not an
Elasticsearch score or permission to resolve a Candidate. Supporting and conflicting
signals coexist so a human review can see uncertainty rather than receiving a
collapsed machine verdict.

## Restricted presentation

SENSITIVE and RESTRICTED signals may only be `MATCH_ONLY` or `HIDDEN`. A presented
view removes every HIDDEN signal. If no signal remains, the complete EntityMatch is
omitted. `MATCH_ONLY` exposes only a controlled result such as `EXACT_MATCH`; it never
contains the compared value or fingerprint.

RESTRICTED Candidates are now permitted only when the caller supplies no display
label. The domain and database replace it with the fixed non-identifying label
`Restricted candidate`. A caller-supplied RESTRICTED label is rejected and cannot be
persisted through direct SQL without violating the database constraint.

## Boundary with P2-007

P2-006 provides a trusted, non-HTTP writer facade and safe presentation policy.
`GET /api/v1/resolutions/{resolutionId}/matches` is deliberately not exposed here.
P2-007 owns the Workspace Entity query, exact protected-Identifier comparison,
`DISCOVER_ENTITY_EXISTENCE` authorization, cross-Case disclosure behavior and the
paginated public endpoint. Returning an Entity reference before that policy decision
would itself be an existence leak.

The trusted writer verifies a current pending Candidate, compatible active Entity,
exact Workspace scope and immutable Candidate/Entity revisions. It does not create,
link, merge or update an Entity and does not resolve the Subject.

## Persistence and events

Resolution migration `0002` expands the Candidate classification constraint and adds
append-only EntityMatch/signal snapshots. Composite foreign keys enforce Candidate
Resolution/Workspace/Case scope and Entity Workspace scope. A unique revision tuple
prevents duplicate snapshots; producer-scoped idempotency supports at-least-once
generation.

`ENTITY_MATCH_RECORDED` is metadata-only and intentionally excludes the Entity ID,
signal field/result, classification, value visibility and all value material. Match
generation is not a critical human action, so it does not create a critical Audit
event. P2-007 must use durable audited access when policy-safe restricted matching is
performed or disclosed.

The migration replaces a CHECK constraint with a strict classification superset and
therefore carries the required safety marker. Apply it before the P2-006 API build;
the operation takes a table lock but performs no destructive data rewrite. Roll back
the API only and retain the additive tables and immutable snapshots.
