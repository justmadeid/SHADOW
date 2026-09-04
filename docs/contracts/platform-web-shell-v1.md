# Platform web shell v1

Owner: `platform-web/src/shell`. Scope: P1-009, not Case CRUD (P1-010).

## Browser surfaces

| Surface | Behavior |
| --- | --- |
| `/` | Redirect to SHADOW, then authenticate if required |
| `/login?returnTo=...` | Organization SSO entry or explicit configuration-unavailable state |
| `GET /auth/login` | Create five-minute encrypted PKCE/state/nonce transaction; redirect to configured OIDC issuer |
| `GET /auth/callback` | Verify transaction/token signatures and API user identity; set encrypted HttpOnly session; redirect to sanitized context |
| `POST /auth/logout` | Require same Origin; expire session/login cookies and return 303 to login; GET does not sign out |
| `/shadow`, `/echo`, `/spectra` | Protected shared shell, Workspace/Case selection and current permission summary |
| `GET /api/platform/session` | `{ user: { id }, expiresAt }`; never access/refresh/ID tokens |
| `GET /api/platform/workspaces[/{id}]` | Current authorized Workspace list/detail; summary fields `id`, `name` only |
| `GET /api/platform/cases?workspaceId=...&cursor=...` | Authorized bounded Case page |
| `GET /api/platform/cases/{id}` | Case summary (`id`, `workspaceId`, `code`, `title`, `classification`, `status`, `revision`) |
| `GET /api/platform/cases/{id}/access` | Current Case capabilities from Governance |

The BFF is an allowlist, not another canonical API. Other paths, extra/duplicate
query fields, arbitrary destinations and mutations are not forwarded. Session and
read responses are private/no-store. Upstream failures return a generic error envelope
with `AUTH_SESSION_EXPIRED` (401) or `PLATFORM_REQUEST_FAILED`; the typed client uses
status to distinguish sign-in, denied context and temporary availability problems.
OIDC setup/discovery failure returns 503 `AUTH_CONFIGURATION_UNAVAILABLE`; invalid
callback returns `/login?error=signin` without provider details.

## Shared context

`ShellContext` has optional Workspace UUID and optional Case UUID; Case requires
Workspace. Navigation across products retains only those IDs. Switching Workspace
clears Case. Neither raw identifiers nor product-local view/filter state crosses
the shared navigation contract. Active Case data is rendered only when its returned
ID/Workspace and current access response agree with the selected context.

`useCaseContext()` exposes authorized Workspace, Case summary and capabilities to
product views inside the guard. It is not an API response store and must not hold
product-local interaction state. Future mutations must still use canonical API
commands; UI capabilities do not authorize writes or imply valid lifecycle actions.

No Workspace/Case is selected automatically. Empty access lists are not errors;
failed requests do not silently become empty lists. Existing Workspace list is
bounded to 100; Case cursor pagination offers Next/First without unbounded prefetch.

## Configuration and rollout

Copy `apps/platform-web/.env.example` to `.env.local` in that app, or inject its
server-only variables at runtime. Do not use `NEXT_PUBLIC_*` for these values.

Required: `WEB_ORIGIN`, `WEB_PLATFORM_API_URL` (including `/api/v1`),
`WEB_OIDC_ISSUER`, `WEB_OIDC_CLIENT_ID`, `WEB_SESSION_KEY` (random 32-byte hex).
Provider-specific: `WEB_OIDC_CLIENT_SECRET` (confidential client),
`WEB_OIDC_AUDIENCE` (API identifier sent in authorization requests),
`WEB_OIDC_SCOPE` (defaults to `openid`; retain that scope). Auth0 requires the
audience and confidential-client secret for the selected setup below. No
provider/client/secret has been provisioned automatically.

The API defaults to port 3000 in the existing root example. When running web on
3000, explicitly run API on 3001 and use that URL; do not point the BFF at itself.
Production endpoints require HTTPS. Loopback HTTP is development-only. Register
exactly `<WEB_ORIGIN>/auth/callback` and browse the same configured origin.

Session lifetime is at most 15 minutes and never beyond declared token/ID expiry.
Reauthentication is required; refresh tokens and provider-wide logout are not
implemented. Stateless logout clears browser cookies but is not centralized
revocation of a previously copied cookie. The encrypted cookie must fit 3800
characters; oversized tokens fail closed. Review these limits before live rollout.

Deploy additive API `/session` and `/cases/{id}/access` first, then web. No database
migration. Runtime config, keys, reverse-proxy callback log redaction, actual issuer
availability, and live-login verification remain deployment responsibilities.
Details: [ADR-004](../engineering/ADR-004_PROTECTED_PLATFORM_SHELL.md).

### Auth0 setup (selected provider)

Register a **Regular Web Application** with Authorization Code enabled and the
exact Allowed Callback URL `<WEB_ORIGIN>/auth/callback` (local example:
`http://localhost:3000/auth/callback`). Set its token endpoint authentication method
to **POST** (`client_secret_post`), matching the server's confidential client.
Register the Platform API with RS256 signing and use its Identifier as audience.
See [Auth0 Authorization Code setup](https://auth0.com/docs/get-started/authentication-and-authorization-flow/authorization-code-flow/call-your-api-using-the-authorization-code-flow)
and [application credentials](https://auth0.com/docs/secure/application-credentials).

| Auth0 value | Web environment | API environment |
| --- | --- | --- |
| Exact issuer, including trailing slash | `WEB_OIDC_ISSUER` | `OIDC_ISSUER` |
| Application Client ID | `WEB_OIDC_CLIENT_ID` | Not the API audience |
| Application Client Secret | `WEB_OIDC_CLIENT_SECRET` | Not needed for JWT verification |
| Platform API Identifier | `WEB_OIDC_AUDIENCE` | `OIDC_AUDIENCE` |
| Issuer discovery `jwks_uri` | Discovered server-side | `OIDC_JWKS_URI` |
| RS256 signing | Verified via discovery/JWKS | `OIDC_ALLOWED_ALGORITHMS=RS256` |

Use one consistent tenant/custom-domain issuer on both services. Never place the
interactive web client in `OIDC_SERVICE_CLIENT_IDS`. Domain membership/permissions
still come from Platform API, not Auth0 roles; a newly signed-in user can correctly
have zero Workspaces. Keep secrets in ignored `.env.local`/secret management, never
in chat, Git, browser storage or `NEXT_PUBLIC_*` variables.

Validate real login, Workspace/Case access, refresh and local sign-out after values
are supplied. This baseline does not call Auth0 logout endpoints or refresh tokens;
the local session ends while the Auth0/provider session may remain. Automated tests
use a synthetic issuer, not the user's Auth0 tenant.
