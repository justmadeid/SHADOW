# ADR-007 — SubjectSeed field provenance and safe presentation

Status: Proposed for review; implemented locally  
Date: 2026-09-07  
Owner: Subject backend; Governance owns classification presentation

## Decision

Store a Subject's initial unresolved identity as one optional, immutable SubjectSeed.
The seed remains Case context and is not promoted to Entity or Knowledge. It is created
in the same transaction as the Subject, idempotency record, revision history and
minimal Outbox event. A Subject cannot acquire, replace or edit a seed after creation.

Each field has a controlled name, normalized string value, origin, classification and
an origin-specific provenance shape. The initial registry contains DISPLAY_NAME,
ORGANIZATION_NAME, USERNAME, DOMAIN_NAME, LOCATION_TEXT and SOCIAL_PROFILE_URL. Fields
are unique within a seed, ordered, bounded to 20 and constrained by Subject type.
Identifiers such as national ID, email and phone are intentionally absent; protected
identifier storage belongs to P2-004.

Origin semantics are strict:

- INVESTIGATOR_INPUT has no Evidence or Source Record reference.
- EVIDENCE and ANALYSIS_EXTRACTION require exactly one same-Workspace, same-Case
  Evidence reference.
- SOURCE_RECORD and IMPORT require exactly one same-Workspace, same-Case Source Record
  reference.

Public Subject creation accepts only INVESTIGATOR_INPUT. A caller cannot self-assert
canonical Evidence, Source Record, extraction or import provenance. Those origins are
modeled for future trusted integrations, which must resolve the referenced aggregate
and verify its scope before calling the domain. The current migration stores typed
reference IDs but does not add foreign keys to aggregates that do not yet exist.

Every stored field carries a classification. PUBLIC, INTERNAL and SENSITIVE can be
persisted in this slice; SENSITIVE values are always returned as a fixed mask from the
seed endpoint. RESTRICTED input fails closed until P2-004 provides protected storage
and comparison primitives. Subject list/detail responses expose only seed ID and field
count, never seed values. Case membership remains mandatory for seed reads.

Seed rows and fields are append-only at the database layer. Subject replay compares
the normalized requested fields with persisted fields under the actor-scoped
idempotency lock. Raw seed values and their digests are excluded from idempotency
records, Outbox payloads, Subject history, cursors and application responses other
than the classification-aware seed endpoint. This avoids turning a plain digest into
an oracle for guessable values.

## Migration safety and rollout

Apply Subject migration 0002 after the P2-001 Subject tables. It only adds tables,
indexes, checks, an append-only function and triggers. Seed and field rows reference
the existing Subject/Workspace/Case scope; field provenance references remain typed
UUIDs until Evidence and Source Record owners can provide canonical foreign keys or
verified ports.

Deploy the migration before the API. Old binaries ignore the additive tables. Roll
back the API build without deleting seed data; do not remove append-only protections
or run a destructive data rollback. This development task does not migrate a user
database.

## Verification

Cover field normalization and type compatibility, exact origin/reference shapes,
cross-scope rejection, restricted-storage rejection, immutable domain snapshots,
public-boundary provenance rejection, sensitive masking, transaction rollback,
idempotent replay conflict, append-only database triggers, bounded values, minimal
Outbox payloads and indistinguishable inaccessible-resource responses.
