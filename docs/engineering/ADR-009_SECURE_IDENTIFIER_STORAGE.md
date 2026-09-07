# ADR-009 — Secure Identifier storage

Status: Accepted for local P2-004 implementation (2026-09-07)

## Context

Entity identifiers such as national IDs, phone numbers and email addresses are both
sensitive and highly guessable. Encryption alone cannot support exact comparison,
while an unkeyed digest permits cheap enumeration. P1-007 already defines fixed-mask,
MATCH_ONLY and FULL field-policy outcomes; P1-008 provides the durable audit release
boundary required before protected disclosure.

## Decision

Identifier is owned by the Entity Registry and remains separate from aliases,
SubjectSeed, Case interpretation and Knowledge. P2-004 supports six controlled types:
NATIONAL_ID, PHONE, EMAIL, PLATFORM_USER_ID, USERNAME and INTERNAL_RESIDENT_ID.
Values are normalized by type under normalization version 1 and bounded to 320 UTF-8
bytes. Clients cannot submit ciphertext, fingerprints, key IDs or display values.

Every Identifier value, regardless of classification, is stored only as randomized
AES-256-GCM ciphertext with a fresh 96-bit nonce and 128-bit authentication tag.
Authenticated associated data binds the ciphertext to its Identifier, Entity,
Workspace, type and classification. These binding fields and protected material are
immutable in PostgreSQL. The application never indexes ciphertext.

Exact equality uses HMAC-SHA-256 with a key distinct from the encryption key. Its
domain-separated input contains the normalization version, Workspace ID, Identifier
type and normalized value. Consequently, the same guessable value has different
fingerprints across Workspaces or types, and no plain SHA-256 digest is persisted.
A uniqueness constraint prevents the same normalized typed value from identifying
multiple Entities inside one Workspace. Key and algorithm IDs are stored explicitly.

The initial deployment accepts one active encryption key and one active fingerprint
key from validated secret-backed environment configuration. Both must be distinct
32-byte base64 values. Key replacement is not an online rotation protocol: operators
must retain the old application/key configuration until a future audited rewrap and
fingerprint backfill migration exists. Changing a fingerprint key without that
migration can defeat duplicate detection and idempotent replay, so it is a blocked
deployment operation rather than an implicit fallback.

POST `/entities/{entityId}/identifiers` requires an active user, active Workspace
membership, WORKSPACE_VIEW and WORKSPACE_MANAGE. It is actor-idempotent and returns a
fixed `••••` mask. GET collection responses are also always fixed-mask and bounded to
100 entries. Neither path decrypts values. Metadata-only creation and audit events use
the transactional Outbox; no value, ciphertext, fingerprint, reason or key ID is sent.

GET `/identifiers/{identifierId}` applies server-side classification policy. For
SENSITIVE/RESTRICTED values:

- no restricted permission or no reason returns fixed MASKED without decrypting;
- IDENTIFIER_USE_RESTRICTED plus reason returns MATCH_ONLY/UNKNOWN and never decrypts;
- IDENTIFIER_VIEW_RESTRICTED plus reason may return FULL only through
  `AuditedDataAccess`, after the critical Audit transaction commits.

Reason-for-access is one of four registered business codes rather than free text, so
the Audit reason channel cannot be repurposed to persist a raw identifier.

The client operation UUID is required with a reason and supplies stable audit retry
identity. It may be omitted only for a request that cannot trigger protected access.
Protected responses use `Cache-Control: private, no-store`. Missing and inaccessible
Entity/Identifier scopes use the same not-found boundary.

## Consequences

Database compromise does not expose plaintext values without the encryption key, and
the comparison column cannot be enumerated without its separate HMAC key. Equality
within a Workspace remains observable to a database reader by design. Application
memory briefly holds normalized plaintext during create or authorized reveal; callers
must keep it out of logs, exceptions, traces and queues. This slice does not implement
fuzzy matching, Candidate resolution, provenance attachment, Identifier revocation,
online key rotation or bulk protected disclosure.

## Deployment and rollback

Provision two different 32-byte keys and stable key IDs in the deployment secret
manager before starting the API. Apply Entity migration 0002 before serving Identifier
routes. Roll back the application build while retaining the additive tables,
ciphertext, fingerprints and key material. Do not drop data or rotate/remove either
key during rollback. Forward key rotation requires a separately reviewed migration.
