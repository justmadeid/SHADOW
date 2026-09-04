# P1 Implementation Status

Date started: 2026-09-03

Milestone: **M1 — Protected Case Shell**

## Task status

| Task | Status | Evidence |
| --- | --- | --- |
| `P1-001` OIDC authentication integration | Complete; merged in PR #4 | OIDC JWT/JWKS verifier, global API guard, user/service principal propagation, public health boundary, stable 401 contract, runtime smoke, and automated negative-path coverage passed the real PR Quality Gate |
| `P1-002` Workspace domain | Complete; merged in PR #5 | UUIDv7 Workspace aggregate, settings, initial membership/history, idempotent persistence, member-scoped reads, Outbox events, migration, and API contract passed the real PR Quality Gate |
| `P1-003` Case domain | Complete; merged in PR #6 | UUIDv7 Case aggregate, opaque human-readable code, classification, lifecycle, optimistic concurrency, Outbox events, migration, and API contract passed the real PR and post-merge Quality Gates |
| `P1-004` Investigation domain | Complete; merged in PR #8 | Case-scoped Investigation branch/objective, lifecycle, idempotency, optimistic concurrency, Outbox events, migration, and API contract passed the real PR Quality Gate |
| `P1-005` Governance permission model | Complete; tracked in PR #9 | Central `PolicyEnforcer`, explicit action/resource/context requests, user/service role grants, scoped PostgreSQL persistence, deny-by-default decisions, revocation, and confidentiality-safe enforcement are covered locally and submitted to the real PR Quality Gate |
| `P1-006` Case membership policy | Implemented locally; user owns Git/PR; current dependency audit passed in P1-008 | Explicit Case OWNER/EDITOR/VIEWER, protected Case/Investigation routes, membership-filtered pagination, transactional grant/revoke history and Outbox, legacy creator migration, and IDOR/concurrency coverage; see validation below |
| `P1-007` Data classification primitive | Implemented locally; user owns Git/PR; current dependency audit passed in P1-008 | Shared classification vocabulary, versioned handling metadata, server display/export/source policy hooks, safe field presenter, no automatic derived downgrade, Case HTTP handling metadata, and negative-path tests; see validation below |
| `P1-008` Critical audit baseline | Implemented and validated locally; user owns commit/PR | Separate append-only Audit, atomic membership/history/Outbox, rollback-only failures, and audited sensitive-access authorization; see ADR-003 and validation below |
| `P1-009` Platform shell auth/workspace/case context | Implemented and validated locally; Auth0 live smoke pending; user owns Git/PR | Server-side OIDC session, guarded shared shell, canonical Workspace/Case navigation, scoped TanStack Query state, and backend-derived capabilities; see ADR-004 and validation below |
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
- [x] Real PR Quality Gate passes.

Validation totals after the Workspace slice: 34 unit tests, 14 PostgreSQL/HTTP
integration tests, 3 contract tests, and 4 Playwright E2E tests passed. The API
boot smoke confirmed `WorkspaceModule` wiring and returned
`401 AUTH_UNAUTHENTICATED` for an unauthenticated workspace list request.

## P1-003 implementation contract

- Owner: Case module.
- Canonical storage: PostgreSQL `cases` and `case_idempotency` tables.
- Create contract: authenticated Workspace member plus `Idempotency-Key`;
  Case starts in `DRAFT` with a UUIDv7 identity and non-sequential opaque code.
- Read contract: list is explicitly Workspace-scoped; detail access verifies
  Workspace membership and returns confidentiality-safe `CASE_NOT_FOUND` when
  the containing Workspace is inaccessible.
- Mutation contract: metadata updates and lifecycle commands require a quoted
  `If-Match` revision; stale writes return `412`.
- Lifecycle: `DRAFT|ACTIVE -> CLOSED`, `CLOSED -> ACTIVE`, and any non-archived
  status may transition to terminal `ARCHIVED`.
- Event contract: `CASE_CREATED`, `CASE_UPDATED`, and `CASE_STATUS_CHANGED` v1
  Outbox events carry resource references, revisions, and changed-field/status
  metadata without titles, descriptions, user identity, or token data.
- Authorization boundary: P1-003 verifies active Workspace membership through
  the Workspace public facade. Case roles and Case-scoped membership policy are
  intentionally deferred to P1-005/P1-006.
- Classification boundary: P1-003 stores the locked classification enum without
  yet implementing P1-007 visibility/export/source policy hooks.

## P1-003 foundation evidence

- [x] Case uses UUIDv7 identity, opaque human-readable code, and positive revision.
- [x] Case creation is idempotent and commits its Outbox event atomically.
- [x] Case list/detail require access to the containing Workspace.
- [x] Metadata update rejects closed/archived Case state.
- [x] Close, reopen, and archive transitions enforce domain invariants.
- [x] Every Case mutation uses optimistic concurrency and increments revision.
- [x] Stale mutation returns `412 CONFLICT_REVISION_MISMATCH`.
- [x] Outbox payloads exclude Case content and authenticated identity.
- [x] Domain tests: 7 passed.
- [x] PostgreSQL integration tests: 5 passed.
- [x] Full local repository quality gate passes.
- [x] Real PR Quality Gate passes.

Validation totals after the Case slice: 41 unit tests, 19 PostgreSQL/HTTP
integration tests, 3 contract tests, and 4 Playwright E2E tests passed. The API
boot smoke confirmed every Case route was mapped; `/health/live` returned `200`
and an unauthenticated Case list returned `401 AUTH_UNAUTHENTICATED`. Gitleaks
found no secrets and the production dependency audit found no known
vulnerabilities.

## P1-004 implementation contract

- Owner: Investigation module.
- Canonical storage: PostgreSQL `investigations` and
  `investigation_idempotency` tables.
- Aggregate shape: each Investigation is a Case sub-unit/branch with one title,
  objective, lifecycle status, and revision.
- Create contract: the `caseId` comes from the path and `workspaceId` is derived
  from the accessible parent Case; neither scope can be supplied in the body.
- Read contract: nested lists filter on both Case and Workspace; detail reads
  revalidate the parent through the public `CaseFacade` and reject mismatched
  persisted scope with confidentiality-safe `404`.
- Lifecycle: `ACTIVE` may pause, complete, or archive; `PAUSED` may resume,
  complete, or archive; `COMPLETED` may reopen or archive; `ARCHIVED` is terminal.
- Mutation contract: PATCH requires quoted `If-Match`; stale writes return `412`.
- Event contract: `INVESTIGATION_CREATED` and `INVESTIGATION_UPDATED` v1 Outbox
  events contain only scope references, revision, and changed-field names.
- Authorization boundary: Case access remains delegated to `CaseFacade`; no
  Case repository or persistence implementation is imported.

## P1-004 foundation evidence

- [x] Investigation uses UUIDv7 identity and positive revision.
- [x] Create is idempotent and derives scope from the parent Case.
- [x] Closed/archived Cases reject new Investigations.
- [x] Case and Workspace cross-boundary reads are confidentiality-safe.
- [x] Persisted `caseId`/`workspaceId` mismatch is rejected for both Workspaces.
- [x] Fresh-database migration order preserves Workspace → Case → Investigation FKs.
- [x] Lifecycle transitions and terminal archive state are enforced.
- [x] Stale PATCH returns `412 CONFLICT_REVISION_MISMATCH`.
- [x] Domain tests: 6 passed.
- [x] PostgreSQL integration tests: 5 passed.
- [x] Full local repository quality gate passes.
- [x] Real PR Quality Gate passes.

Validation totals after the Investigation slice: 47 unit tests, 25
PostgreSQL/HTTP integration tests, 3 contract tests, and 4 Playwright E2E tests
passed. Runtime boot mapped all four Investigation routes and an unauthenticated
detail request returned `401 AUTH_UNAUTHENTICATED`. Gitleaks found no secrets and
the production dependency audit found no known vulnerabilities.

## P1-005 implementation contract

- Owner: Governance module; other domains consume only its exported
  `PolicyEnforcer` facade.
- Policy request: a registered action, typed resource reference with Workspace
  scope, and optional Case/Investigation/reason-for-access context.
- Subject model: OIDC-authenticated `USER` and allowlisted `SERVICE` principals
  are evaluated as distinct subject types; matching text identifiers cannot
  cross principal kinds.
- Role model: Workspace-owned roles contain an explicit permission set. A grant
  never implies another permission, including restricted identifier use versus
  restricted identifier view.
- Scope model: grants apply to a whole Workspace, one Case, or one exact typed
  resource. Contextual Case scope is evaluated centrally.
- Decision contract: missing principal, missing permission, scope mismatch, and
  missing reason-for-access are stable deny outcomes. No grant means deny.
- Enforcement contract: callers may return `403 ACCESS_DENIED` or request a
  confidentiality-safe resource-specific `404` without duplicating policy
  evaluation.
- Persistence: PostgreSQL owns roles, role permissions, assignments, and
  append-only assignment grant/revoke history. Active roles and assignments are
  joined for every decision; revocation takes effect on the next evaluation.
- Deferred integration: Case membership provisioning and protected Case route
  enforcement belong to P1-006. Classification-aware field/source/export hooks
  belong to P1-007; critical durable audit delivery belongs to P1-008.
- Deferred surface: Governance administration HTTP endpoints remain outside the
  field-complete API baseline, matching the locked OpenAPI skeleton.

## P1-005 foundation evidence

- [x] Role, permission, action, resource, and context are explicit typed models.
- [x] Workspace, Case, and exact-resource scopes are evaluated centrally.
- [x] Permission-to-use remains distinct from permission-to-view.
- [x] Restricted operations can require non-empty reason-for-access context.
- [x] User and service identities use separate assignment namespaces.
- [x] Missing grant and scope mismatch are deny-by-default decisions.
- [x] Callers can enforce a normal `403` or confidentiality-safe `404`.
- [x] Revoked assignments stop authorizing immediately.
- [x] Assignment history records append-only `GRANTED` and `REVOKED` changes.
- [x] Fresh-database migration order preserves the Workspace foreign key.
- [x] Governance unit tests: 9 passed.
- [x] Governance PostgreSQL integration tests: 4 passed.
- [x] Full local repository quality gate passes.

Validation totals after the Governance slice: 56 unit tests, 29 PostgreSQL/HTTP
integration tests, 3 contract tests, and 4 Playwright E2E tests passed. The full
local static/build gate and Gitleaks scan also passed; the PR Quality Gate will
independently run the production dependency audit.

## P1-006 implementation contract

- Owners: Governance owns canonical membership and policy; Case owns access
  orchestration; Workspace supplies active-member eligibility through its facade.
- Canonical storage: typed Case-scoped Governance assignments, not a duplicated
  Case membership table. `OWNER`, `EDITOR`, and `VIEWER` are explicit system roles.
- Case creation atomically provisions the creator's OWNER membership. Replays
  reauthorize and cannot revive revoked creators.
- Case/Investigation reads require active Workspace membership and Case membership.
  Writes also require the appropriate action permission. Workspace-wide or generic
  resource grants cannot substitute for membership; denied detail access is safe 404.
- Member grant/revoke application commands require Case-scoped administration
  permission and a reason. Targets must be active Workspace members. Same-role
  grant is idempotent, different-role grant conflicts, and revoke checks revision.
- Per-Case transaction locking serializes membership changes with Case/Investigation
  mutations and rechecks access after acquiring the lock. The last active Case
  OWNER assignment cannot be removed, including concurrent removals.
- Case lists filter authorized IDs before pagination, return at most 100 items,
  and provide Workspace-bound opaque cursors. No totals disclose hidden Cases.
- `CASE_MEMBERSHIP_CHANGED` v1 Outbox intent and append-only history commit together.
  History records actor/reason; events contain only resource/history references,
  action, and revision. Central audit delivery remains P1-008.
- Additive migration `governance/0002_case_membership.sql` backfills OWNER only for
  existing creators still active in the Workspace. Applied `0001` files are unchanged.
- Public membership administration routes, recovery workflows, Workspace owner
  removal coordination, and classification-specific hooks are not part of this slice.
- ADR and rollout implications: [ADR-001](ADR-001_CASE_MEMBERSHIP.md).

## P1-006 validation evidence (2026-09-04)

- Unit: 66 passed, including explicit membership and role capability boundaries.
- PostgreSQL/HTTP: 41 tests cover the complete integration suite, including 11
  Case-access scenarios and legacy migration coverage. Negative paths include
  same-Workspace nonmembers, cross-Case IDs, service principals, removed Workspace
  members, broad grants, revoked replay, revision conflict, and cross-Case revoke.
- Concurrency: last-owner preservation and queued Case/Investigation writes after
  revocation are tested against PostgreSQL transactions.
- Atomicity: forced membership-Outbox failure rolls back new Case/owner creation
  and idempotency; runtime membership history/events exclude sensitive payloads.
- HTTP success tests exposed raw-SQL timestamp strings in Case/Investigation
  persistence; mapping now normalizes these to domain Dates before serialization.
- Full static gate passed: architecture/dependency boundaries, formatting, lint,
  typecheck, unit/contract tests, six migration files, OpenAPI lint, and build.
- Contract: 3 tests passed. Case list pagination/security semantics are documented
  in the field-complete OpenAPI contract; no new admin endpoint was introduced.
- Playwright: 4 foundation E2E tests passed. Gitleaks: no secrets found.
- Production dependency audit is **unverified**: a bounded retry returned
  `ERR_SOCKET_TIMEOUT` from the npm registry audit endpoint. No dependency or
  lockfile changes were made; rerun the audit when the registry is reachable.
- Test startup initially stalled in Docker Desktop's credential helper. A
  process-local anonymous `DOCKER_AUTH_CONFIG` allowed public test images without
  modifying saved Docker credentials. One subsequent container startup timed out;
  integration results must use the final rerun rather than skipped tests.
- No commit, pull, push, PR, production migration, or deployment was performed.
  Changes remain local for the user's Git workflow and remote Quality Gate.

## P1-007 implementation contract

- Owner: Governance; canonical wire vocabulary in `@intelligence/contracts`.
  Depends on P1-005; current Case access still uses the P1-006 boundary.
- Shared PUBLIC/INTERNAL/SENSITIVE/RESTRICTED and FULL/MASKED/MATCH_ONLY/HIDDEN
  enums are no longer duplicated in the Case domain.
- `classificationHandling` provides policy-version-1 obligations for display,
  logs, metrics, queue, search, raw persistence, export, routing, retention,
  object access, and cross-Case disclosure. Metadata does not grant access.
- `ClassificationPolicy` evaluates authenticated base access and additional
  display/export/source permissions without product-name branching. Owners must
  still resolve canonical scope and active Workspace/Case eligibility first.
- Sensitive identifiers default to MASKED; use permission plus reason gives
  MATCH_ONLY, while view permission plus reason can give FULL. Sensitive text
  needs explicit server full-view policy and reason. Denied base access is HIDDEN.
- The field presenter constructs minimal discriminated responses. MASKED is a
  fixed placeholder; MATCH_ONLY omits values; HIDDEN omits values and match status.
- Export requires policy, permission, and reason; sensitive export needs explicit
  policy permission, and RESTRICTED cannot allow unredacted export. Source access
  requires enabled source-use policy; restricted use additionally needs explicit
  restricted permission/reason and restricted routing, with raw data disabled or
  explicitly minimized. These are planning hooks, not source/export executors.
- `deriveClassification` preserves the maximum input sensitivity and rejects
  missing/invalid inputs or requested downgrade. Manual Case reclassification
  remains its existing authorized, revision-checked metadata command.
- Case responses now include server-derived `handling`; request bodies cannot
  override it. No new HTTP endpoint, database migration, event, or network egress.
- Sensitive display and source/export decisions report durable-audit obligations.
  Actual audit execution remains P1-008; identifier/source/export/retention runtimes
  remain their later domain slices. No new sensitive operation is exposed here.
- Detailed decisions and limitations: [ADR-002](ADR-002_CLASSIFICATION_POLICY_HOOKS.md).

## P1-007 validation evidence (2026-09-04)

- Unit: 101 passed, including 35 classification/handling/policy tests. Tests cover
  all classifications, invalid input, monotonic propagation, FULL/MASKED/MATCH_ONLY/
  HIDDEN, use/view separation, reason requirements, source/export denial, and
  identical SHADOW/ECHO/SPECTRA behavior.
- PostgreSQL/HTTP integration: 43 passed, including persisted use/view grants,
  revocation, Case/Workspace scope denial, additive Case handling metadata, and
  rejection of client-supplied policy metadata. Existing P1-006 isolation remains.
- Contract: 6 passed, including the shared enum, field-response discriminants,
  and versioned handling shape. OpenAPI validates the new Case `handling` contract.
- Static/build: architecture and dependency boundaries, formatting, lint,
  typecheck, migration validation, and build passed. No SQL migration was changed.
- Frozen offline pnpm installation passed. The lockfile change adds only the
  existing local `@intelligence/contracts` link to platform-api; no third-party
  package version was changed.
- Playwright: 4 foundation E2E tests passed. Gitleaks found no secrets.
- Production dependency audit remains **unverified**: the bounded audit attempt
  returned `ERR_SOCKET_TIMEOUT` from the npm registry. Rerun when the registry is
  reachable; the feature does not add or update any third-party dependency.
- No commit, pull, push, PR, database migration, or deployment was performed.

## P1-008 implementation contract

- Owner: Audit; canonical source of truth is append-only PostgreSQL `audit_events`.
  Dependencies: P0-007 transactional Outbox and P1-005 Governance; integrates the
  P1-006 membership boundary and P1-007 classification policy hooks.
- Case creator OWNER initialization, grant and revoke commit business state,
  Governance history, canonical Audit, and reference-only Outbox atomically.
  No-op grants/idempotent Case replay do not produce duplicate Audit records.
- Authenticated USER/SERVICE actor and correlation come from RequestContext.
  Typed fields reject arbitrary payloads and actor spoofing. Protected reasons
  remain in canonical storage, not queue payloads or exception causes.
- Audit failures mark the entire transaction rollback-only, even if a caller
  catches the error. Database triggers reject UPDATE, DELETE and TRUNCATE.
  Duplicate operation identity with different canonical content returns 409.
- `AuditedDataAccess` owns the commit boundary for sensitive display and
  source/export authorization. It rechecks policy after acquiring the Case lock,
  audits before loading sensitive fields, and releases the result only after
  commit. MASKED/HIDDEN never load raw fields; MATCH_ONLY never returns values.
- Export/source records mean AUTHORIZED or DENIED intent, not completed external
  execution. No new source/export/audit HTTP API, frontend, or consumer was added.
  Existing Case metadata and internal generic provisioning are not globally
  intercepted; future command owners must adopt the Audit facade.
- One additive migration; no historical Audit backfill or changes to applied SQL.
  Runtime database role restrictions and external immutable archival are deployment
  concerns; triggers are not protection against malicious superuser/DDL access.
- Contracts: [critical-audit-v1](../contracts/critical-audit-v1.md), Case-create
  `503 AUDIT_DURABILITY_FAILED` in OpenAPI, and [ADR-003](ADR-003_CRITICAL_AUDIT_BASELINE.md).

## P1-008 validation evidence (2026-09-04)

- Unit: **120 passed**, including strict Audit input, verified actor propagation,
  sanitized errors, and rollback-only transaction-context isolation.
- PostgreSQL/HTTP integration: **55 passed**, including 11 dedicated Audit tests
  and the Case HTTP 503 failure path. Covers failed canonical/Outbox inserts,
  create/grant rollback, caught-failure revocation rollback, immutable triggers,
  concurrent deduplication/conflicts, commit-before-disclosure, safe masking/match,
  revocation/retry, and AUTHORIZED/DENIED source/export intents.
- Contract: **6 passed**; OpenAPI lint passed with the additional 503 response.
- Static/build: architecture boundaries (119 source files), 6 boundary tests,
  dependency graph, formatting, lint, typecheck, and all package builds passed.
- Migration gate: **7 SQL migrations** passed; repository migrations also applied
  successfully through the real migration runner on ephemeral PostgreSQL.
- Playwright: **4 foundation E2E tests passed**. No new UI is introduced.
- Security: Gitleaks found no secrets. Production `pnpm audit --prod
  --audit-level=high` succeeded and reported **no known vulnerabilities**. This
  resolves the earlier registry-timeout verification gap for the current tree.
  No third-party dependency or lockfile change was required by P1-008.
- No commit, pull, push, PR, user-database migration or deployment was performed.
  Apply the additive Audit migration before starting the new API build; preserve
  Audit data on rollback. User owns the Git workflow and remote Quality Gate.

## P1-009 implementation contract

- Owner: shared platform web shell. Canonical identity comes from OIDC and API
  authentication; Workspace/Case data and Governance capabilities remain in the
  Platform API. Dependencies: P1-002, P1-003 and P1-006.
- Auth0 is the selected provider. Authorization Code + PKCE runs server-side with
  state/nonce and ID-token signature validation, configured API audience, and
  confidential-client authentication. No provider tenant/settings were changed.
- Tokens stay inside an encrypted HttpOnly session cookie, never browser-accessible
  storage or API JSON. Session duration is capped at 15 minutes and token expiry.
  POST-only exact-Origin logout clears cookies and other tabs clear their UI/cache.
- Authenticated users navigate SHADOW/ECHO/SPECTRA with the same UUID Workspace/Case
  context. Workspace switching clears Case; deep links are reauthorized and reject
  mismatched contexts. Product-local state does not cross the navigation contract.
- TanStack Query owns bounded, non-persistent server state. Loading, empty, denied,
  expired and unavailable states are explicit. Capabilities are backend decisions,
  never permission grants invented in the browser.
- Additive API contracts: `GET /api/v1/session` and
  `GET /api/v1/cases/{caseId}/access`. Browser BFF routes allow only specific reads
  and return validated minimal summaries. No new domain mutation/event, raw-field
  disclosure, critical Audit action, source call, database schema or migration.
- Contracts and operational decisions:
  [web shell v1 and Auth0 setup](../contracts/platform-web-shell-v1.md),
  [Platform API OpenAPI](../contracts/platform-api-v1.yaml),
  [ADR-004](ADR-004_PROTECTED_PLATFORM_SHELL.md).

## P1-009 validation evidence (2026-09-04)

- Unit: **152 passed**; includes redirect/context validation, read-only proxy
  allowlists, cookie integrity/purpose/expiry/size, endpoint configuration, and
  strict API response parsing without reflecting upstream secrets/errors.
- PostgreSQL/HTTP integration: **57 passed**, including user-only session identity
  and Case capability isolation for owner/viewer/outsider and revoked membership.
- Contract: **6 passed**; expanded OpenAPI lint passed.
- Playwright: **20 passed with retries disabled**. Separate loopback synthetic
  issuer/API exercises PKCE, confidential client secret, audience, signed ID token,
  callback state rejection, login/refresh, cross-product context, Workspace switch,
  viewer capabilities, revocation, background expiry, same-tab/cross-tab logout,
  BFF write/CSRF rejection, empty/error states and literal untrusted label rendering.
- Desktop and 390px mobile screenshots were visually inspected; mobile overflow
  assertion passed. No synthetic data/auth bypass is imported into the app.
- Full `m0:static` passed: architecture (136 source files), 6 boundary tests,
  dependency graph, formatting, lint, typecheck, 7-migration validation and all
  package builds. Shared product routes are dynamic and about 120 kB first-load JS.
- pnpm 10.15.0 frozen-lockfile installation passed for all 16 workspace projects.
  Added React Query/query-core, openid-client/oauth4webapi and server-only; reused
  the existing jose version. Existing package versions were not upgraded; pnpm also
  normalized optional `supports-color` peer-resolution suffixes in the lockfile.
- Security: production dependency audit reports **no known vulnerabilities**;
  Gitleaks reports **no leaks**; `git diff --check` passed.
- Live Auth0 login is **not yet verified**: supply tenant issuer, web Client ID,
  API Identifier, server-only client secret/session key and matching API config;
  register the exact callback and perform the documented smoke test. The synthetic
  test provider is not evidence of tenant connectivity or real role provisioning.
- Intentional baseline limits: no refresh tokens, provider-wide logout or centrally
  revocable session store; oversized encrypted cookies fail closed. Local sign-out
  does not invalidate a copied cookie before its expiry/backend token rejection.
- No commit, pull, push, PR, user-database migration or deployment was performed.
  Deploy the additive API reads before web. Case CRUD UI remains **P1-010**.
