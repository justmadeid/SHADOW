# Platform shell

P1-009 owns shared authentication, Workspace/Case context and product navigation.
Canonical state remains in Platform API; TanStack Query is the only client server-state
cache. Product-local interactions belong under `products/<product>` and must not be
shared through this context. `useCaseContext()` is available only inside the authorized
Case boundary. Server-only OIDC/session/BFF helpers live in `server/`.

See `docs/contracts/platform-web-shell-v1.md` and `docs/engineering/ADR-004_PROTECTED_PLATFORM_SHELL.md`.
