# ADR-017 — NodeDefinition registry as a trusted internal capability catalog

Status: Proposed for review; implemented locally
Date: 2026-09-08
Owner: Workflow backend; Governance owns permission tokens

## Decision

Ship a versioned NodeDefinition registry that expresses capability, never connector
implementation. A NodeDefinition names an abstract capability token (e.g.
`PERSON_LOOKUP`) plus typed inputs/outputs/configSchema, an execution policy
(timeout, retryable), a review policy, a `requiredPermission` drawn from
Governance's registered permission set, and presentation metadata. Construction is
strict allow-list parsing that structurally rejects any `connectorId`, `connector`
or `sourceId` key, mirroring `subject-input.ts`'s `record()` mass-assignment guard.
This is not a convention; a unit test proves the rejection, and it is the literal
P3-001 acceptance criterion.

The registry is a key+version catalog with no public write HTTP endpoint. Per
`docs/knowledge/15_PLATFORM_API_CONTRACT_MAP.md` §12, only `GET /node-definitions`
(latest ACTIVE version per key, cursor-paginated, default 50/max 100) and
`GET /node-definitions/{key}/versions/{version}` exist publicly, both requiring only
an authenticated principal and no Case/Workspace scoping — this is a global platform
catalog, not Case data. `register()` on the `NodeDefinitionRegistry` port is a
trusted application port, never a DTO supplied by an HTTP caller, using the same
posture already established for `CanonicalEntityResolver`: only trusted application
code may call it directly. Today that is the module's own bootstrap (none is wired
in this slice, since P3-001 seeds nothing); a future capability-owning module (a
Source Registry/connector task) is the intended caller.

Deliberately, this slice ships an empty catalog. No production NodeDefinition (e.g.
an invented "person-lookup" business row wired to any real capability) is seeded,
because inventing one now would preempt the ownership of a future Source
Registry/connector task. Tests register synthetic NodeDefinitions directly through
the trusted port, the same pattern this repository already uses for synthetic
identities elsewhere.

`register()` is idempotent on exact key+version: a byte-for-byte identical shape
replay returns the existing row unchanged. A different shape submitted for an
already-registered key+version is rejected with
`409 CONFLICT_NODE_DEFINITION_KEY_VERSION_REUSED` — key+version is treated as an
immutable content-addressed identity, not a mutable slot future callers can silently
overwrite.

`capability` is validated only as an abstract uppercase-snake token
(`^[A-Z][A-Z0-9_]{2,63}$`); it is never validated or stored alongside, or format-
compatible with, a connector identifier. `requiredPermission` must be a permission
Governance has registered (drawn from the same `PERMISSIONS` array Case membership
enforcement already uses), so a NodeDefinition can never gate itself behind a
permission token nothing else recognizes.

## Migration safety and rollout

Two additive forward migrations create `node_definitions` (unique on `key,version`,
JSONB columns for inputs/outputs/configSchema/executionPolicy/reviewPolicy/
presentation, CHECK constraints on category/capability/status) and, in a later
migration, `node_instances`' composite foreign key back into `node_definitions
(key, version)`. Neither migration alters or removes existing tables. The catalog
ships empty; no seed data is written by migration or by this task. Rolling back the
API build leaves an empty, harmless table behind.

## Verification

Unit tests cover: strict allow-list rejection of `connectorId`/`connector`/
`sourceId` (the literal acceptance criterion), capability-token format rejection of
a connector-shaped string, unknown top-level fields, duplicate field names,
out-of-range execution timeout, and an unregistered `requiredPermission`.
Idempotent-replay and conflicting-shape-409 behavior is exercised by the workflow
module's PostgreSQL integration suite (see ADR-018's verification section for the
combined workflow-module gate results, since NodeDefinition and NodeInstance share
one integration harness).
