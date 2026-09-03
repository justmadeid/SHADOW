# M0 — Engineering Ready Gate

Run these gates on a developer/CI environment with Docker + network/package cache.

## Bootstrap

- [x] `corepack enable`
- [x] `pnpm install --frozen-lockfile` after initial lockfile is generated and committed.
- [x] `.env` and infrastructure dev env created from examples.

## Local infrastructure

- [x] `pnpm dev:infra`
- [x] `pnpm dev:infra:check`
- [x] PostgreSQL healthy.
- [x] Redis healthy.
- [x] MinIO healthy and private dev bucket exists.
- [x] **Investigation** Elasticsearch healthy.
- [x] OTel Collector healthy.
- [x] Jaeger reachable.
- [x] No Resident Elasticsearch exists in platform compose.

## Database

- [x] `pnpm migrations:validate`
- [x] `pnpm db:migrate`
- [x] migration rerun is no-op.
- [x] changing an applied migration checksum is rejected.

## Applications

- [x] `platform-api` boots.
- [x] `/health/live` returns 200.
- [x] `/health/ready` returns 200 when PostgreSQL is healthy.
- [x] `/api/v1/system/info` returns requestId + traceId.
- [x] `platform-web` boots and SHADOW/ECHO/SPECTRA routes render.
- [x] worker processes boot and shut down cleanly.

## Observability

- [x] API request appears in trace backend.
- [x] requestId is present in structured log.
- [x] PII redaction smoke passes.
- [x] restricted identifier values do not appear in log/trace.

## Architecture

- [x] `pnpm check:architecture` passes.
- [x] intentional SHADOW → ECHO internal import fixture fails.
- [x] intentional module A → module B infrastructure import fixture fails.

## Tests

- [x] unit tests pass.
- [x] contract tests pass.
- [x] PostgreSQL Testcontainers integration passes.
- [x] Outbox rollback/lease integration passes.
- [x] Playwright foundation smoke passes.

## Contracts/security/build

- [x] Redocly lint passes.
- [x] Gitleaks passes.
- [x] production dependency audit reviewed.
- [x] `pnpm build` passes for all deployables/packages.
- [x] GitHub `Quality Gate` passes on a real PR.
- [x] third-party actions are pinned to reviewed commit SHAs before branch protection.

## Exit rule

Only after all required checks above pass can the project claim:

> **M0 — Engineering Ready**

Then start P1 Auth, Workspace, Case & Governance.
