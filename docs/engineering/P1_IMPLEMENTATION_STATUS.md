# P1 Implementation Status

Date started: 2026-09-03

Milestone: **M1 — Protected Case Shell**

## Task status

| Task | Status | Evidence |
| --- | --- | --- |
| `P1-001` OIDC authentication integration | Complete; merged in PR #4 | OIDC JWT/JWKS verifier, global API guard, user/service principal propagation, public health boundary, stable 401 contract, runtime smoke, and automated negative-path coverage passed the real PR Quality Gate |
| `P1-002` Workspace domain | Complete locally; PR pending | UUIDv7 Workspace aggregate, settings, initial membership/history, idempotent persistence, member-scoped reads, Outbox events, migration, and initial API contract implemented on `feat/p1-002-workspace-domain` |
| `P1-003` Case domain | Not started | Depends on P1-002 |
| `P1-004` Investigation domain | Not started | Depends on P1-003 |
| `P1-005` Governance permission model | Not started | Depends on P1-001 and P1-002 |
| `P1-006` Case membership policy | Not started | Depends on P1-003 and P1-005 |
| `P1-007` Data classification primitive | Not started | Depends on P1-005 |
| `P1-008` Critical audit baseline | Not started | Depends on P1-005 |
| `P1-009` Platform shell auth/workspace/case context | Not started | Depends on backend Workspace, Case, and membership foundations |
| `P1-010` Case CRUD UI in SHADOW | Not started | Depends on P1-004 and P1-009 |

## P1-001 implementation contract

- Owner: platform authentication.
- Identity source of truth: configured OIDC issuer and its JWKS endpoint.
- Public client contract: `Authorization: Bearer <access-token>`.
- Authenticated context: verified `USER` or allowlisted `SERVICE` principal.
- Authorization boundary: authentication does not assign domain roles or permissions.
- Public exception: liveness and readiness endpoints remain unauthenticated.
- Failure contract: all missing, malformed, or invalid credentials return
  `401 AUTH_UNAUTHENTICATED` without exposing verification detail.
- Configuration: issuer, audience, JWKS URI, asymmetric signing-algorithm
  allowlist, and service-client allowlist are explicit environment values.

## P1-001 completion gate

- [x] Bearer header parsing and size limit covered by unit tests.
- [x] Signature, issuer, audience, expiry, and required claims validated.
- [x] Service identity requires an allowlisted OIDC client ID.
- [x] Authenticated principal is propagated through `RequestContext`.
- [x] Public and protected HTTP behavior covered by integration tests.
- [x] Stable `401` error code and Bearer challenge covered.
- [x] OpenAPI bearer security contract added.
- [x] Full local repository quality gate passes.

## P1-001 validation evidence

- Unit: 29 tests passed, including real asymmetric JWT signing and local JWKS
  verification.
- Integration: 10 tests passed, including public/protected HTTP behavior and
  user/service principal propagation.
- Contract: 3 tests passed; Redocly validates the expanded OpenAPI contract.
- Architecture: 55 source files scanned, 6 boundary tests passed, and
  dependency-cruiser reports no violations.
- Runtime: `/health/live` returned `200`; unauthenticated
  `/api/v1/system/info` returned `401 AUTH_UNAUTHENTICATED` with a Bearer
  challenge and request ID.
- E2E: 4 Playwright foundation tests passed.
- Security: Gitleaks found no secrets and the production dependency audit found
  no known vulnerabilities.
- Toolchain: pnpm `10.15.0` completed a frozen-lockfile installation for all 16
  workspace projects.

## P1-002 implementation contract

- Owner: Workspace module.
- Canonical storage: PostgreSQL `workspaces`, `workspace_settings`,
  `workspace_members`, and append-only `workspace_membership_history` tables.
- Create contract: authenticated user plus `Idempotency-Key`; creation adds the
  creator as an active member in the same transaction.
- Read contract: list and detail queries are filtered by active user membership;
  inaccessible workspace IDs return confidentiality-safe `404`.
- Event contract: `WORKSPACE_CREATED` and `WORKSPACE_MEMBERSHIP_CHANGED` v1
  Outbox events carry references and revisions, not user identity or token data.
- Authorization boundary: the module enforces user membership scoping but does
  not invent roles or permissions before P1-005 Governance.
- Deferred surface: workspace update and member-management HTTP commands wait
  for PolicyEnforcer so no temporary over-permissive API is introduced.

## P1-002 foundation evidence

- [x] Workspace and membership use UUIDv7 IDs and positive revisions.
- [x] Workspace settings are modeled separately from membership.
- [x] Initial membership history is append-only and committed atomically.
- [x] Workspace creation and two Outbox events share one transaction.
- [x] Identical idempotency replay returns the same workspace.
- [x] Conflicting idempotency replay returns `409`.
- [x] Cross-user read returns a confidentiality-safe `404`.
- [x] Service principal cannot masquerade as a workspace member.
- [x] Domain tests: 5 passed.
- [x] PostgreSQL integration tests: 4 passed.
- [x] Full local repository quality gate passes.
- [ ] Real PR Quality Gate passes.

Validation totals after the Workspace slice: 34 unit tests, 14 PostgreSQL/HTTP
integration tests, 3 contract tests, and 4 Playwright E2E tests passed. The API
boot smoke confirmed `WorkspaceModule` wiring and returned
`401 AUTH_UNAUTHENTICATED` for an unauthenticated workspace list request.
