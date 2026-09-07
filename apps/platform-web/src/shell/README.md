# Platform shell

P1-009 owns shared authentication, Workspace/Case context and product navigation.
Canonical state remains in Platform API; TanStack Query is the only client server-state
cache. Product-local interactions belong under `products/<product>` and must not be
shared through this context. `useWorkspaceContext()` exposes authorized Workspace and
bounded Case-page context; `useCaseContext()` additionally requires an authorized active
Case. P1-010 commands remain in `products/shadow`, never in this shared shell. Server-only
OIDC/session/BFF helpers live in `server/`.

See `docs/contracts/platform-web-shell-v1.md`,
`docs/engineering/ADR-004_PROTECTED_PLATFORM_SHELL.md`, and
`docs/engineering/ADR-005_SHADOW_CASE_COMMAND_UI.md`.
