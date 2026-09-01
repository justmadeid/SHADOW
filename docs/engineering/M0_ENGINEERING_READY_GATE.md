# M0 — Engineering Ready Gate

Run these gates on a developer/CI environment with Docker + network/package cache.

## Bootstrap

- [ ] `corepack enable`
- [ ] `pnpm install --frozen-lockfile` after initial lockfile is generated and committed.
- [ ] `.env` and infrastructure dev env created from examples.

## Local infrastructure

- [ ] `pnpm dev:infra`
- [ ] `pnpm dev:infra:check`
- [ ] PostgreSQL healthy.
- [ ] Redis healthy.
- [ ] MinIO healthy and private dev bucket exists.
- [ ] **Investigation** Elasticsearch healthy.
- [ ] OTel Collector healthy.
- [ ] Jaeger reachable.
- [ ] No Resident Elasticsearch exists in platform compose.

## Database

- [ ] `pnpm migrations:validate`
- [ ] `pnpm db:migrate`
- [ ] migration rerun is no-op.
- [ ] changing an applied migration checksum is rejected.

## Applications

- [ ] `platform-api` boots.
- [ ] `/health/live` returns 200.
- [ ] `/health/ready` returns 200 when PostgreSQL is healthy.
- [ ] `/api/v1/system/info` returns requestId + traceId.
- [ ] `platform-web` boots and SHADOW/ECHO/SPECTRA routes render.
- [ ] worker processes boot and shut down cleanly.

## Observability

- [ ] API request appears in trace backend.
- [ ] requestId is present in structured log.
- [ ] PII redaction smoke passes.
- [ ] restricted identifier values do not appear in log/trace.

## Architecture

- [ ] `pnpm check:architecture` passes.
- [ ] intentional SHADOW → ECHO internal import fixture fails.
- [ ] intentional module A → module B infrastructure import fixture fails.

## Tests

- [ ] unit tests pass.
- [ ] contract tests pass.
- [ ] PostgreSQL Testcontainers integration passes.
- [ ] Outbox rollback/lease integration passes.
- [ ] Playwright foundation smoke passes.

## Contracts/security/build

- [ ] Redocly lint passes.
- [ ] Gitleaks passes.
- [ ] production dependency audit reviewed.
- [ ] `pnpm build` passes for all deployables/packages.
- [ ] GitHub `Quality Gate` passes on a real PR.
- [ ] third-party actions are pinned to reviewed commit SHAs before branch protection.

## Exit rule

Only after all required checks above pass can the project claim:

> **M0 — Engineering Ready**

Then start P1 Auth, Workspace, Case & Governance.
