# ADR-002 — Classification primitives and policy hooks

**Status:** Proposed for review; implemented locally in P1-007  
**Date:** 2026-09-04  
**Owner:** Governance; shared wire vocabulary in `@intelligence/contracts`

## Context and decision

The locked handling matrix distinguishes PUBLIC, INTERNAL, SENSITIVE, and
RESTRICTED. A classification label is neither authentication nor an access grant.
P1-007 introduces versioned handling metadata and server-side planning hooks, not
new identifier, export, ingestion, or source-query endpoints.

- Shared contract constants/types are canonical for classification and visibility;
  Case imports them rather than maintaining a second enum. Existing DB constraints
  are unchanged and remain the persistence boundary.
- Governance owns `classificationHandling`, `deriveClassification`,
  `ClassificationPolicy`, and `presentClassifiedField` through its public index.
- `classificationHandling` returns a fresh value with policy version 1. It covers
  display defaults, logs, metrics, queue, search, raw persistence, export, worker
  routing, retention, object access, and cross-Case disclosure. These are obligations
  to be consumed by owners, not proof that those runtimes already exist.
- Derived classification is the maximum of every contributing input; requested
  elevation is allowed, requested downgrade or empty/invalid lineage is rejected.
  Manual Case metadata reclassification remains the explicit, revision-checked
  P1-003 command; this helper is not an automatic downgrade or declassification API.

## Authorization and field presentation

All three hooks evaluate the caller's base `PolicyRequest` using the current
authenticated principal. PUBLIC does not skip that step. Canonical resource scope,
active Workspace eligibility, Case access, and source policy must be resolved by
the owning domain first; these hooks do not look up another domain's tables or
infer scope from request JSON. Case callers keep the P1-006 membership-required
base policy. Extra permissions retain the same resource/Case context but may be
separate Governance grants, rather than builtin membership-role permissions.

Display rules after base access:

- PUBLIC/INTERNAL fields allow FULL unless a more restrictive full-view permission
  is explicitly configured by the server.
- SENSITIVE/RESTRICTED identifiers require `IDENTIFIER_VIEW_RESTRICTED` plus reason
  for FULL. `IDENTIFIER_USE_RESTRICTED` plus reason yields MATCH_ONLY, never FULL.
  Without either, the result is MASKED. Sensitive text remains HIDDEN without an
  explicit server-configured full-view permission and reason.
- MASKED uses a fixed four-bullet placeholder: no prefix, suffix, original length,
  raw value, or match status. MATCH_ONLY contains only an allowlisted match status;
  HIDDEN contains neither. The presenter constructs new objects and never spreads
  source fields. Non-full modes do not need to load the raw value.
- FULL text remains untrusted plain text. Frontends must render it as text, not
  unsafe HTML. Identifier kind/classification, matched status, and the decision
  itself are server-owned; never deserialize a browser-provided policy decision.

## Export and source hooks

Export defaults to deny without an enabled server policy, `EVIDENCE_EXPORT`, and
reason. Sensitive/restricted exports need an additional explicit policy permission.
RESTRICTED exports must be redacted even when the user can view a full identifier.
The future exporter must actually redact each field; `redacted: true` is a required
server execution plan, not client attestation or completed redaction.

Source access defaults to deny without an enabled policy and its use permission.
RESTRICTED requires an explicit restricted-use permission and reason. View rights
must never be configured as source-use rights. Restricted raw persistence is
DISABLED unless MINIMIZED is explicitly selected; a generic SOURCE_POLICY value
cannot enable raw storage. Sensitive raw persistence is at most MINIMIZED.
Restricted routing is a mandatory obligation; no connector/network call is added.
Permission choices are trusted domain configuration, not HTTP request fields.

## Audit, provenance, and operational boundaries

Sensitive FULL/MATCH_ONLY decisions and all export/source decisions carry
`requiresDurableAudit`. An allowed decision is necessary but not sufficient to
release data: future executors must persist the required intent before disclosure
or side effects, and enforce redaction, retention, routing, and source controls.
P1-008 owns the durable audit executor; P2 owns identifier persistence/views; P4
owns source registry/ingestion; P11 owns export and retention runtimes.

Hooks do not fetch raw values, log reasons/content, create events, or mutate data.
Existing P1-006 grant/revoke history and Outbox remain unchanged. Revoked grants
take effect on the next evaluation; decisions must not be cached as durable grants.

## Alternatives and consequences

- Frontend-only masking was rejected: raw data would already be disclosed.
- Product-name branching was rejected: the same policy applies to SHADOW/ECHO/SPECTRA.
- Broad new permissions and source/export endpoints were deferred until their
  owning domain contracts exist. Current hooks accept registered permissions from
  trusted configuration; there is no new persisted grant or automatic role upgrade.
- Fixed masking sacrifices identifier suffix recognition in exchange for a safe
  type-agnostic default. Type-specific partial masking can be reviewed in P2.

## Compatibility, performance, and rollout

Case responses add `handling` derived from their persisted classification. Clients
may use this metadata for notices, but it does not authorize buttons, unmask values,
or replace server enforcement. Existing Case metadata access remains P1-006; the
new per-field hooks are not retroactive classification filtering of every Case title.

No migration, new third-party dependency, source egress, or deployment is required.
The only dependency change is the existing local contracts workspace package.
Metadata/lineage calculations are pure; each hook makes a bounded number of policy
queries (display at most four, export/source at most three). Batch field-policy
evaluation should be designed when high-volume identifier read models arrive.
Rollback removes the additive metadata/hooks without rewriting canonical data.

## References

P1-008 follow-up: [ADR-003](ADR-003_CRITICAL_AUDIT_BASELINE.md) adds the
`AuditedDataAccess` commit boundary and separate canonical Audit store. The pure
planning hooks above still do not execute or satisfy audit on their own.

- P1-007 in `docs/knowledge/20_DEVELOPMENT_BACKLOG_V1.md`
- `docs/knowledge/34_DATA_CLASSIFICATION_HANDLING_MATRIX.md`
- `docs/knowledge/08_CROSS_CUTTING_ARCHITECTURE.md`
- `docs/contracts/platform-api-v1.yaml`
- `docs/engineering/ADR-001_CASE_MEMBERSHIP.md`
