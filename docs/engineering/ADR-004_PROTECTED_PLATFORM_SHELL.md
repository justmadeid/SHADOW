# ADR-004 — Protected platform shell and web session boundary

**Status:** Proposed for review; implemented locally in P1-009  
**Date:** 2026-09-04  
**Owners:** Platform web shell; Authentication; Case/Governance

## Context

P1-002/P1-003/P1-006 provide canonical Workspace/Case membership and protected
resource reads. The web application previously rendered unauthenticated foundation
pages. P1-009 must share authenticated Workspace/Case context across SHADOW, ECHO
and SPECTRA without duplicating domain state or sharing product-local interactions.
Case creation/editing/Investigation commands remain P1-010.

## Decision

The Next.js shell owns navigation and context presentation. PostgreSQL-backed
Platform API remains the canonical source of truth; Governance determines
permissions. The browser only calls a same-origin, read-only Backend-for-Frontend
(BFF). There is no direct browser API token, client-side token store, generic proxy,
worker credential, or duplicate domain database.

### Authentication

- `openid-client` performs Authorization Code + S256 PKCE, state and nonce checks,
  ID-token issuer/audience/expiry validation and explicit signature verification.
  Discovery uses the configured trusted issuer, bounded timeouts and no redirects.
- Callback verifies the access token against the Platform API `/session` endpoint
  and requires its authenticated user ID to equal the ID-token subject. A service
  principal is rejected, even if it has a valid API token.
- A five-minute encrypted login cookie binds the browser to its PKCE/state/nonce
  transaction. It is consumed before token exchange. Return targets are restricted
  to known products and UUID Workspace/Case parameters; no arbitrary redirects.
- Session is a jose A256GCM encrypted/authenticated cookie with origin/purpose
  binding, HttpOnly, SameSite=Lax, Path=/, and Secure plus `__Host-` prefix on HTTPS.
  It contains access token and subject, never a refresh token. No credential is
  accessible through browser JavaScript, localStorage, sessionStorage or UI JSON.
- Lifetime is the minimum of 15 minutes, token-endpoint `expires_in`, and ID-token
  expiry. API token validation remains authoritative on each backend call. Missing
  expiry or encrypted cookie above 3800 characters fails closed. Large-token
  providers need a separately designed server-side session store, not silent cookie
  truncation. No default session key or mock authentication fallback exists.
- Local sign-out is POST-only with exact configured Origin validation. It expires
  cookies and navigates away; another tab clears memory through BroadcastChannel.
  Native form submission must finish before removing the form. No provider-wide
  logout, refresh, server-side session registry or per-session revocation store is
  claimed. A copied cookie remains usable until expiry/backend token rejection;
  key rotation invalidates all web sessions. Deployers must accept this bounded
  baseline or add centrally revocable sessions before requiring that guarantee.

### Server and browser authorization boundaries

The protected server layout verifies session with the API before rendering the
shell. Every BFF read uses the encrypted session token and re-enters backend auth.
Middleware only supplies CSP/security headers and a sanitized return target; it
is not the sole access-control boundary. API outages do not fall back to fake data.

`GET /api/v1/session` returns only `{ user: { id } }` for verified users.
`GET /api/v1/cases/{caseId}/access` resolves canonical Workspace/Case access, acquires
the P1-006 membership lock, rechecks access and asks Governance for current view,
update, Investigation-create and membership-manage capabilities. Inaccessible and
absent Cases remain confidentiality-safe 404. Capabilities are UI guidance only;
future commands still reauthorize and validate their domain state.

The BFF accepts only allowlisted GET Workspace/Case/session routes. It cannot
forward arbitrary hosts, headers, write methods, internal worker routes or source
URLs. JSON responses are validated and reduced to the fields the shell needs;
canonical creator identity, description and unrelated fields are not forwarded.
Error messages are generic; provider/API bodies and tokens are not reflected.

### Context and state

Logical `Product`, `ShellContext`, `productHref`, `parseShellContext` and
`safeReturnTo` live in shared contracts. Routes are currently:

```text
/shadow?workspaceId=<UUID>&caseId=<UUID>
/echo?workspaceId=<UUID>&caseId=<UUID>
/spectra?workspaceId=<UUID>&caseId=<UUID>
```

Switching product preserves only canonical context, not product-local filters,
canvas state, raw identifiers or arbitrary query fields. Switching Workspace
explicitly drops Case. A Case without Workspace, duplicate context fields and
invalid UUIDs are rejected. Context is resolved against current API data before
rendering the product view; possession of a URL is not authorization.

TanStack Query owns server state; React context exposes the current authorized
Workspace/Case/capabilities. There is no second Zustand/global response cache.
Queries use scoped keys, AbortSignal, no persistent cache and zero inactive-cache
retention. Context changes unmount their old scope. Session 401 clears memory and
hides protected content. Refetch occurs on focus/navigation and at bounded 30-second
intervals; background refresh does not reset product interaction state. Known access
errors hide protected detail and selected labels. Backend enforcement is immediate;
the open browser is not a push-revocation channel and may show previously authorized
content until the next check. Browser back-forward cache restore triggers revalidation.

Workspace list uses the existing bounded 100-result API; no new Workspace pagination
contract is invented. Case selection supports the backend cursor page with Next/First
controls and does not fetch every Case. Empty, loading, denied and unavailable states
are distinct. The shell shows a capability summary without fake future action buttons.

## Alternatives considered

- Browser-local bearer token storage: simpler deployment but increases persistent
  credential exposure to JavaScript; rejected.
- Direct browser-to-API requests: possible, but requires browser token handling and
  cross-origin configuration; deferred in favor of a fixed same-origin BFF.
- Full server-side session database/Redis: enables immediate session invalidation
  and larger token storage, but adds operational ownership/retention work. Deferred;
  the stateless 15-minute limit is explicit, not a substitute for that feature.
- Frontend-derived roles and permissions: rejected; Governance is authoritative.
- Persisting product state in the shared shell: rejected to preserve extraction
  boundaries. Product-local tools are not part of P1-009.

## Security, observability and audit implications

The shell renders server text with React, never raw HTML, and adds nonce-based CSP,
same-origin referrers (no cross-origin referrers), nosniff, no framing and
private/no-store responses. Auth routes use `no-referrer` to protect callback codes;
normal pages preserve Origin for exact-origin native logout POSTs. Production requires
HTTPS endpoints; only loopback HTTP is allowed outside production. Encrypted cookies
are not tamper-proof against a compromised session key; store/rotate keys outside Git
and use the same key on all web replicas. Secure cookies must be served from the
exact configured public origin, not an untrusted Host header.

No raw identifier disclosure, source call, export or permission mutation is added,
so no new critical Audit action/event is invented. Existing API request correlation
and PII-safe logs apply; the BFF creates request IDs for upstream calls. Do not log
cookie/authorization headers, callback query strings, token responses or exception
causes from OIDC. Reverse-proxy/access-log configuration must redact auth callback
query strings and credentials; the callback receives short-lived authorization
codes by protocol, never access tokens in its URL.

## Performance and operational consequences

Read requests incur a BFF hop. Scope-specific bounded queries avoid loading graphs,
source payloads or full Case history. A session check and at most two detail reads
are used for a selected Case; no unbounded permission fan-out is introduced.
Discovery happens at login/callback, not every UI data fetch. Network timeout is
eight seconds. No background refresh-token job or additional infrastructure exists.

Deploy API `/session` and Case `/access` before the new web build. Set the web-only
environment values from `apps/platform-web/.env.example`; register exact
`<WEB_ORIGIN>/auth/callback` at the issuer. The access token must target the backend's
configured OIDC audience (`WEB_OIDC_AUDIENCE` for Auth0); scopes/audience are provider configuration, not
authorization grants from the browser. API and web must use separate local ports.
Provider setup and a live organization-login smoke remain operator work.

No SQL migration, business write, or domain event change is required. Rollback web
and clear/rotate the new session cookies; the additive API reads may remain. Do not
roll back API first while the new web build depends on these contracts.

## Validation and references

Real backend HTTP/PostgreSQL tests cover session identity and Case permission
isolation/revocation. Browser E2E uses a separate loopback-only synthetic OIDC/API
process with real code exchange, PKCE, signed ID tokens, encryption and cookies;
there is no test bypass in application auth. It proves web protocol/UI wiring,
not a live organization IdP deployment. Unit tests cover cookie tampering/expiry,
redirect/path allowlists, configuration validation and sanitized client parsing.
Results are tracked in [P1 status](P1_IMPLEMENTATION_STATUS.md).

- [Web shell contract](../contracts/platform-web-shell-v1.md)
- [Next.js authentication guidance](https://nextjs.org/docs/app/guides/authentication)
- [openid-client OIDC example](https://github.com/panva/openid-client/blob/main/examples/oidc.ts)
- [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- Architecture/security/test guides 08, 19, 22, 23, 25, 33 and SHADOW specifications
  under `docs/product/shadow/`; P1-009 in development backlog.
