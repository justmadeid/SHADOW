# P2 implementation status — Reusable Identity Core

## Baseline (2026-09-07)

P1-009 merged via PR #13 and P1-010 via PR #14. Synchronization PR #16 preserves
exactly the final P1-010 tree. P2-001 merged via PR #17; P2-002 through P2-004 merged
together via PR #18. P2 contains P2-001 through P2-012 and targets M2 Reusable Identity Core.
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

P2-010 owns Add Target UI and is not included in this implementation.

## P2-002 — SubjectSeed field provenance implemented locally

Owner: backend Subject module. SubjectSeed is immutable initial Case context, not an
Entity or Knowledge record. Scope and safety decisions are in
[ADR-007](ADR-007_SUBJECT_SEED_PROVENANCE.md).

Implemented:

- Optional Subject creation seed with six controlled field names, Subject-type
  compatibility, field normalization, uniqueness and strict size/count bounds.
- Required per-field origin and classification. Domain provenance supports typed
  Evidence and Source Record references with exact same-Workspace/same-Case scope.
  Public callers can submit only INVESTIGATOR_INPUT and cannot self-assert canonical
  source provenance.
- PUBLIC/INTERNAL/SENSITIVE persistence; SENSITIVE presentation is fixed-mask.
  RESTRICTED storage fails closed pending P2-004. National IDs, email and phone are
  absent from the seed registry and remain owned by secure identifier storage.
- Atomic Subject/seed/idempotency/history/Outbox persistence. Seed tables and fields
  are append-only. Replay compares normalized stored fields without putting raw values
  or guessable-value digests in idempotency state.
- Authorized GET /subjects/{subjectId}/seed plus seed ID/count metadata on Subject
  responses. Lists, detail responses, Outbox, history and cursors contain no values.
- Forward-only Subject migration 0002, OpenAPI contract expansion and domain,
  contract and PostgreSQL/HTTP coverage. No UI surface is added in this slice.

### Deferred integration

Evidence and Source Record origins are domain-supported but deliberately unavailable
to public callers until their owning aggregates provide trusted scope-verification
ports. Protected RESTRICTED values and comparison fingerprints remain P2-004 work.

## P2-001 validation (2026-09-07)

- Full m0:static passed: 181 unit tests, 9 contract tests, architecture (150 source
  files), 6 boundary tests, dependency graph, formatting, lint, typecheck, validation
  of 9 migrations, OpenAPI lint and all production builds.
- PostgreSQL/HTTP: 66 tests passed, including 9 new Subject tests covering concurrent
  replay, key conflict, revision races, role permissions, cross-scope denial,
  revocation, parent lifecycle, Investigation mismatch, paging, mass assignment,
  history protection, premature resolution denial and Outbox failure rollback.
- Existing platform-web regression: 25 Playwright tests passed. Production dependency
  audit reports no known vulnerabilities and Gitleaks reports no leaks.
- Test fixtures use disposable PostgreSQL and synthetic authentication. The completed
  implementation merged via PR #17. No user database migration or deployment was
  performed by the implementation task.

## P2-002 validation (2026-09-07)

- Full m0:static passed: 188 unit tests, 9 contract tests, architecture (152 source
  files), 6 boundary tests, dependency graph, formatting, lint, typecheck, validation
  of 10 migrations, OpenAPI lint and all production builds.
- PostgreSQL/HTTP integration passed 68 tests, including 11 Subject scenarios. New
  coverage verifies normalized typed fields, provenance shape, sensitive masking,
  append-only seed rows, unverified-origin rejection, incompatible/oversized fields,
  restricted-storage denial, replay comparison, cross-scope denial and Outbox-failure
  rollback of both Subject and seed.
- Existing SHADOW/ECHO web regression passed 25 Playwright tests. Production
  dependency audit reports no known vulnerabilities and Gitleaks reports no leaks.
- Test fixtures use disposable PostgreSQL and synthetic authentication. P2-002 later
  merged together with P2-003/P2-004 via PR #18. No user database migration or
  deployment was performed by the implementation task.

## P2-003 — Entity Registry aggregate implemented locally

Owner: backend Entity Registry module. Entity is reusable Workspace identity and never
Case interpretation. Scope and rollout decisions are in
[ADR-008](ADR-008_THIN_ENTITY_REGISTRY.md).

Implemented:

- Thin immutable Entity snapshots with stable UUIDv7 ID, Workspace, 14 controlled
  types, ACTIVE/MERGED/ARCHIVED lifecycle, canonical label, append-only aliases,
  optional merge reference, revision and UTC timestamps.
- NFKC label normalization, case-insensitive alias uniqueness, strict bounds and
  non-destructive rename that retains the prior canonical label. Type/Workspace are
  immutable; archive is terminal. Identifier and Case/Knowledge fields are rejected.
- POST/GET /workspaces/{workspaceId}/entities and GET/PATCH /entities/{entityId}.
  Registry reads require active membership plus WORKSPACE_VIEW; direct curation
  requires WORKSPACE_MANAGE. Inaccessible detail/list is undisclosed. Service
  principals cannot use this user curation surface.
- Actor-scoped idempotent create without identity-value digests, compare-and-set
  updates, append-only revision/alias rows and metadata-only Outbox events in one
  transaction. Stable-ID paging is bound to Workspace.
- Trusted canonical resolver returns only ACTIVE same-Workspace Entities and follows a
  bounded persisted merge chain. Creating merge state is still prohibited until the
  audited P2-011 merge command.
- Forward-only Entity migration 0001, explicit migration-owner order, OpenAPI contract
  and domain/contract/PostgreSQL HTTP coverage. No SHADOW/ECHO UI is added.

### Deferred integration

P2-004 owns secure identifiers. P2-007 owns possible-match queries and cross-Case
existence disclosure. P2-008 owns normal Candidate-driven Entity creation and atomic
Subject resolution. P2-011/P2-012 own audited merge and reversal.

## P2-003 validation (2026-09-07)

- Full m0:static passed: 194 unit tests, 12 contract tests, architecture (163 source
  files), 6 boundary tests, dependency graph, formatting, lint, typecheck, validation
  of 11 migrations, OpenAPI lint and all production builds.
- Full PostgreSQL/HTTP integration passed 75 tests. The 7 Entity scenarios cover
  replay and cross-Workspace key conflicts, identity-only mass-assignment rejection,
  non-destructive rename/alias history, stale revision races, terminal archive,
  view/manage separation, membership revocation, hidden scope, stable paging,
  active/merged resolution, append-only protection, metadata-only Outbox and complete
  rollback. The Entity suite was rerun after its final query/idempotency changes.
- Existing SHADOW/ECHO regression passed 25 Playwright tests. Production dependency
  audit reports no known vulnerabilities and Gitleaks reports no leaks.
- Test fixtures use disposable PostgreSQL, synthetic identities and synthetic grants.
  P2-003 later merged together with P2-002/P2-004 via PR #18. No user database
  migration or deployment was performed by the implementation task.

## P2-004 — Secure Identifier storage implemented locally

Owner: Entity Registry with Security/Governance enforcement. Decisions and deployment
constraints are recorded in
[ADR-009](ADR-009_SECURE_IDENTIFIER_STORAGE.md).

Implemented:

- Six controlled Identifier types with strict per-type normalization and a 320-byte
  ceiling. Caller-supplied ciphertext, fingerprints, key metadata and display fields
  are rejected.
- Randomized AES-256-GCM storage for every value. Ciphertext is authenticated against
  Identifier/Entity/Workspace/type/classification context; protected columns are
  immutable. Exact comparison uses a separate, domain-separated HMAC-SHA-256 keyed by
  Workspace and type—never a plain digest of a guessable identifier.
- Required, distinct 32-byte encryption/fingerprint keys and stable key IDs in API
  configuration. The schema records algorithms, key IDs and normalization version;
  online rotation/backfill remains an explicit future operation.
- POST/GET `/entities/{entityId}/identifiers` and GET
  `/identifiers/{identifierId}`. Create/list responses are fixed-mask and no-store.
  Detail applies existing Governance field policy: mask by default, use-only becomes
  MATCH_ONLY without decryption, and view plus a controlled reason code permits
  audited FULL disclosure without a free-text identifier channel.
- Active Workspace membership plus view/manage separation, hidden inaccessible scope,
  actor-idempotent creation, Workspace-level duplicate prevention, a 100-Identifier
  bound, append-only metadata history and metadata-only transactional Outbox.
- Forward-only Entity migration 0002, OpenAPI contract, cryptographic/domain/contract
  tests and PostgreSQL/HTTP field-policy coverage. No SHADOW/ECHO UI is added.

### Deferred integration

P2-006 owns explainable matching signals and will consume the protected exact-match
capability without exposing values. Provenance and revocation commands, bulk protected
disclosure and audited online key rotation are not claimed by P2-004.

## P2-004 validation (2026-09-07)

- Full m0:static passed: 198 unit tests, 15 contract tests, architecture (172 source
  files), 6 boundary tests, dependency graph, formatting, lint, typecheck, validation
  of 12 migrations, OpenAPI lint and all production builds.
- Full PostgreSQL/HTTP integration passed 78 tests. The 10 combined Entity scenarios
  include three secure-Identifier flows covering randomized authenticated encryption,
  non-plain-HMAC fingerprint evidence, Workspace/type dedupe, replay conflicts,
  immutable storage/history, fixed masking, use/view permission separation, controlled
  audit reasons, durable disclosure audit, grant revocation, hidden scope,
  metadata-only Outbox and complete rollback.
- Existing SHADOW/ECHO regression passed 25 Playwright tests. Production dependency
  audit reports no known vulnerabilities and Gitleaks reports no leaks.
- Test fixtures use disposable PostgreSQL, synthetic identifiers, synthetic keys and
  synthetic grants. P2-002/P2-003/P2-004 merged via PR #18. No user database migration
  or deployment was performed by the implementation task.

## P2-005 — ResolutionSession and Candidate model implemented locally

Owner: backend Resolution module. Scope and safety decisions are recorded in
[ADR-010](ADR-010_RESOLUTION_CANDIDATE_MODEL.md).

Implemented:

- Case-scoped ResolutionSession lifecycle with stable UUIDv7 IDs, positive revisions,
  Candidate counts, and terminal selected Candidate/decision references.
- Non-canonical identity Candidate lifecycle for PERSON, ORGANIZATION, SOCIAL_ACCOUNT
  and DOMAIN. Typed Subjects accept only compatible Candidates; UNKNOWN Subjects may
  accept any supported identity type.
- Controlled origin plus same-Workspace/same-Case Source Record, Evidence, Run or
  Analysis provenance references; up to 20 unique Evidence references per Candidate.
- Controlled decision outcomes and reason codes. Conclusive outcomes require an Entity
  ID in the decision artifact but do not perform Entity or Subject mutation.
- Transaction-required, producer-scoped idempotent session/Candidate persistence,
  append-only source links/history/decision tables and metadata-only Outbox events.
- Authorized GET session/list/detail API, stable cursor pagination bound to Resolution,
  Workspace and Case, confidentiality-safe 404s, and ETag revisions.
- Forward-only Resolution migration, explicit migration-owner order, OpenAPI contract,
  domain/contract/PostgreSQL/HTTP tests. No SHADOW/ECHO UI is added.

### Deferred integration

P2-008 owns the public start/resolve commands and the critical atomic transaction across decision,
Entity create/link and Subject resolution. Source/Evidence/Run/Analysis existence is
validated structurally now and must use trusted owner verification ports as those
modules arrive. There is intentionally no public Candidate creation or resolution
mutation in P2-005.

## P2-005 validation (2026-09-07)

- Full m0:static passed: 205 unit tests, 17 contract tests, architecture (184 source
  files), 6 boundary tests, dependency graph, formatting, lint, typecheck, validation
  of 13 migrations, OpenAPI lint and all production builds.
- Full PostgreSQL/HTTP integration passed 85 tests. The 7 new Resolution scenarios
  cover idempotent session/Candidate persistence, scoped source and Evidence links,
  authorization and membership revocation, hidden resources, stable cursor paging,
  prohibited premature mutation routes, transaction rollback and append-only history.
- Existing SHADOW/ECHO regression passed 25 Playwright tests. Production dependency
  audit reports no known vulnerabilities and Gitleaks reports no leaks.
- Test fixtures use disposable PostgreSQL, synthetic candidates and synthetic
  authentication. No user database migration or deployment was performed.

## P2-006 — MatchingSignal / ConflictSignal model implemented locally

Owner: backend Resolution module. Scope and security decisions are recorded in
[ADR-011](ADR-011_MATCHING_SIGNAL_VISIBILITY.md).

Implemented:

- Immutable EntityMatch snapshots pin Candidate/Entity revisions and retain both
  supporting and contradicting signals without treating search relevance as identity
  confidence.
- Controlled field, result, strength, classification, visibility and match-level
  vocabularies. Signal artifacts contain no raw/masked value, fingerprint, numeric
  score or free-text rationale.
- SENSITIVE/RESTRICTED signals allow only MATCH_ONLY/HIDDEN. Safe presentation removes
  HIDDEN signals and suppresses an EntityMatch entirely when Entity discovery is not
  authorized or no visible signal remains.
- RESTRICTED Candidate input prohibits a raw display label and persists only the fixed
  non-identifying label `Restricted candidate`, enforced in domain and PostgreSQL.
- Transaction-required trusted writer, producer-scoped idempotency, immutable snapshot
  tuple, append-only signal tables, composite scope FKs and metadata-only Outbox.
- Forward-only Resolution migration 0002, Candidate OpenAPI update, typed signal
  contract, domain/contract and PostgreSQL integration coverage. No SHADOW/ECHO UI is
  added.

### Deferred integration

P2-007 owns protected exact-Identifier comparison, governance-aware Workspace Entity
query, `DISCOVER_ENTITY_EXISTENCE`, cross-Case disclosure and the paginated public
`/resolutions/{resolutionId}/matches` endpoint. P2-008 remains the only owner of
Candidate decisions and atomic Entity/Subject mutation.

## P2-006 validation (2026-09-08)

- Full m0:static passed: 209 unit tests, 18 contract tests, architecture (187 source
  files), 6 boundary tests, dependency graph, formatting, lint, typecheck, validation
  of 14 migrations, OpenAPI lint and all production builds.
- Full PostgreSQL/HTTP integration passed 88 tests. The 10 Resolution scenarios now
  include three matching-signal flows covering deterministic snapshot replay,
  producer-scoped idempotency, restricted-safe persistence, target compatibility,
  fixed Candidate labels, append-only storage and complete Outbox rollback.
- Existing SHADOW/ECHO regression passed 25 Playwright tests. Production dependency
  audit reports no known vulnerabilities and Gitleaks reports no leaks.
- Test fixtures use disposable PostgreSQL, synthetic identities and synthetic
  authentication. No user database migration or deployment was performed.

## Deployment and rollback

Review/apply migrations before deploying the API. Governance 0003 replaces a CHECK
with a strict superset and backfills system Case capabilities; ADR-006 documents the
safety-marker rationale and table-lock consideration. Roll back the API build only;
retain Subject/Entity/Identifier history and additive permissions. P2-004 additionally
requires two distinct 32-byte secret-manager keys and stable key IDs before API start;
do not rotate or remove them without the rewrap/fingerprint-backfill process described
by ADR-009. Apply the additive Resolution 0001 migration before deploying the P2-005
API and retain its session, Candidate and history tables when rolling the API back. No
destructive data rollback. Apply Resolution 0002 before the P2-006 build; it replaces
the Candidate classification CHECK with a strict superset and adds immutable match
snapshot tables. ADR-011 records the short table-lock and rollback constraints.
