# ADR-005 — SHADOW Case command UI and mutation boundary

**Status:** Proposed for review; implemented locally in P1-010  
**Date:** 2026-09-06  
**Owners:** SHADOW frontend; Case and Investigation canonical APIs

## Context

P1-009 provides an authenticated, shared Workspace/Case shell. P1-010 must let an
analyst create, list, open, edit and close a Case and create an Investigation without
turning SHADOW into a business API, duplicating server state, or weakening the Case
membership and Governance rules established in P1-003 through P1-008.

## Decision

The interaction UI lives under `products/shadow`; ECHO/SPECTRA and the shell do not
import it. Shared shell context exposes the authorized Workspace, bounded current
Case page, active Case detail and backend capabilities. TanStack Query remains the
single browser server-state cache. Form and confirmation state is component-local.

SHADOW calls a same-origin BFF that forwards only these canonical operations:

```text
POST  /cases
PATCH /cases/{caseId}
POST  /cases/{caseId}/actions/{close|reopen|archive}
GET   /cases/{caseId}/investigations
POST  /cases/{caseId}/investigations
```

The BFF requires exact configured Origin for every mutation, allows no query fields,
limits bodies to 8192 bytes, validates exact writable fields and domain length/enums,
and forwards only generated request ID, access token, content type,
`Idempotency-Key`, and quoted `If-Match`. It never accepts a destination, arbitrary
header, internal path, member/role field, creator, status field in metadata updates,
or raw error body. API authorization is re-evaluated on every operation.

Case and Investigation creation retain a browser idempotency key per submitted payload
until success or component unmount, with no automatic mutation retry. Case edits
submit the revision captured when the form opened, even after background refresh.
Lifecycle commands submit the displayed canonical revision. A 412 is shown as a
stale-write conflict; the edit form offers an explicit reload/discard action.
Successful commands invalidate scoped Case/Investigation queries; there is no
speculative canonical state. A 401 immediately clears protected client state.

Hard delete does not exist. Archive is an explicit, confirmed terminal lifecycle
command, preserving history and Outbox/Audit behavior. Close is confirmed and may be
reopened. Closed/archived Cases cannot edit metadata or create Investigations. UI
buttons follow backend capabilities for usability, but hiding a button is never the
authorization control.

## Scope and consequences

The current table shows the bounded page already owned by the shell. Existing cursor
controls remain the pagination mechanism; no unbounded Case load, client-side fake
filter, assignee, alert, or activity read model is invented. Investigation update or
dedicated Investigation workspace is outside P1-010; only bounded list and create are
shown. Case membership management remains outside this UI.

No API domain endpoint, schema, migration, event, connector egress or new sensitive
Audit category is added. Canonical Case creation continues to atomically establish
OWNER membership and required Audit/Outbox records. React renders all labels and
descriptions as text. Backend classification and authorization remain authoritative.

## Validation and rollout

Unit tests cover parsers, mutation headers, path/body allowlists, mass assignment,
payload limits and revision syntax. Browser tests cover create/open/edit/close/reopen,
confirmed archive, Investigation creation, read-only capability behavior, stale
revision, CSRF, literal untrusted text and responsive layout. Existing backend
PostgreSQL tests remain the canonical proof of idempotency, transaction, membership,
authorization and optimistic concurrency.

Deploy the existing protected API contracts before the web build. There is no data
migration. Rollback only the web build; canonical records created by users remain.
Auth0 live smoke and production deployment are separate operator gates.

- [Web shell/BFF contract](../contracts/platform-web-shell-v1.md)
- [Platform API OpenAPI](../contracts/platform-api-v1.yaml)
- [ADR-004 protected shell](ADR-004_PROTECTED_PLATFORM_SHELL.md)
