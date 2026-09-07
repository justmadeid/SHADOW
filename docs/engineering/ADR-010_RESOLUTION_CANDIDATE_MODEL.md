# ADR-010 — ResolutionSession and non-canonical Candidate model

**Status:** Accepted for P2-005 implementation (2026-09-07)  
**Owner:** Resolution backend domain  
**Dependencies:** P2-001 Subject, P2-003 Entity Registry, P1 Case governance

## Decision

Resolution owns a Case-scoped `ResolutionSession`, identity `Candidate`, immutable
source/evidence linkage and controlled `ResolutionDecision`. A Candidate is a review
artifact and cannot contain, create or mutate a canonical Entity. P2-005 deliberately
does not expose start-resolution or resolve commands. P2-008 must commit any conclusive
decision, Entity create/link and Subject resolution atomically.

The identity Candidate types are `PERSON`, `ORGANIZATION`, `SOCIAL_ACCOUNT` and
`DOMAIN`, matching resolvable Subject types. Relationship candidates remain a separate
Knowledge/cross-product concept. An `UNKNOWN` Subject may receive any identity
Candidate type; a typed Subject accepts only the same type.

## Lifecycle and decisions

A session starts `SEARCHING`, becomes `NEEDS_REVIEW` when the first Candidate is
registered, and terminates as `RESOLVED` or `CLOSED`. A Candidate starts
`PENDING_REVIEW`; the controlled outcomes map it to `RESOLVED`, `REJECTED` or
`UNCERTAIN`. `LINK_EXISTING` and `CREATE_NEW` require a target Entity ID in the
decision artifact, but this model performs no Entity mutation. `REJECT` and
`UNCERTAIN` prohibit one.

Decision rationale uses a controlled reason code rather than free text. Candidate and
session histories, source/evidence links and decisions are append-only. Stable
UUIDv7 IDs and positive revisions are used throughout.

## Provenance and classification

Candidate origin is controlled and shape-checked:

- investigator input has no source resource;
- Source Record/import points to a Source Record;
- Evidence points to Evidence;
- Run points to Run;
- analysis extraction points to Analysis.

Every source and Evidence reference must carry the exact Candidate Workspace and Case.
They are opaque provenance pointers and never grant access to the referenced resource.
Existence validation is deferred until the owning Source/Evidence/Execution modules
provide trusted scope-verification ports.

Candidate display labels may be PUBLIC, INTERNAL or SENSITIVE. RESTRICTED presentation
fails closed in P2-005 because P2-006 owns policy-safe match/conflict signals and field
visibility. Labels, source IDs and Evidence IDs never enter Outbox payloads or logs.

## API and authorization

P2-005 exposes only authenticated reads:

- `GET /api/v1/resolutions/{resolutionId}`;
- `GET /api/v1/resolutions/{resolutionId}/candidates`;
- `GET /api/v1/candidates/{candidateId}`.

Current `SUBJECT_VIEW` permission and active Case membership authorize all three.
Absent and inaccessible resources use indistinguishable Resolution/Candidate 404s.
Candidate pages use a cursor bound to Resolution, Workspace and Case. Service
principals cannot use this user review surface.

## Persistence and rollout

The forward migration follows Entity, Subject and Governance migrations. Session and
Candidate creation are transaction-required and idempotent; Candidate replay compares
the normalized stored record rather than retaining a digest of a potentially sensitive
display label. Business records, revision history and metadata-only Outbox events
commit together. Candidate producer retry keys are scoped by producer type and ID.

Deploy the additive migration before the API. Roll back the API binary only and retain
all Resolution tables and history. P2-006 may add signals without changing Candidate
identity; P2-008 will add the audited atomic decision coordinator and Subject/Entity
state expansion.
