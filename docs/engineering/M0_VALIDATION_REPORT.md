# M0 Validation Report

Date: 2026-09-03

Workspace: `intelligence-platform-docs`

Status: **M0 — Engineering Ready**

## Decision

Every requirement in
`docs/engineering/M0_ENGINEERING_READY_GATE.md` has passed. Pull request `#2`
merged the workflow-bootstrap correction as commit `525c8ba`; its PR-triggered
Engineering Quality run `33692145028` passed Static, Integration, E2E,
Security, and the final stable `Quality Gate` job.

The GitHub ruleset `QC` (`22152818`) is active on the default branch. It
requires pull requests, resolved review conversations, an up-to-date branch,
and the GitHub Actions `Quality Gate`; it also prevents branch deletion and
force pushes. GitHub's repository API reports `main` as protected.

The bootstrap validation status has been reconciled now that the authoritative
gate is present. The legacy v2.1 `manifest.json` was preserved rather than
rewritten as if it represented this v3.1 scaffold.

M0 may therefore claim **M0 — Engineering Ready**. No P1 domain or SHADOW
feature implementation was started during M0 validation.

## Validation environment

- macOS local development host with Node.js `v26.7.0` and pnpm `11.19.0`
- clean Linux container validation with Node.js `v22.23.2`, Corepack `0.36.0`,
  and pnpm `10.15.0`
- Docker Engine `28.3.2`
- local synthetic, ignored `.env` files only

The generated lockfile uses lockfile format `9.0`. Corepack enablement, a frozen
install, and the complete M0 gate pass with the exact pinned Node 22 + pnpm
10.15.0 toolchain both locally and in the required GitHub PR workflow.

## Gate results

| Gate | Result | Evidence |
| --- | --- | --- |
| Bootstrap/toolchain | PASS | Corepack enabled; pnpm 10.15.0 frozen install succeeds in a clean Node 22 container; both environment examples exist |
| Architecture boundaries | PASS | 49 source files scanned; 5 positive/negative boundary tests pass; dependency-cruiser reports no violations |
| Format and lint | PASS | Prettier check and ESLint with zero warnings allowed |
| TypeScript | PASS | 15/15 workspace packages typecheck |
| Unit tests | PASS | 5 files, 12 tests |
| Contract tests | PASS | 1 file, 3 API primitive contract tests; empty-suite success disabled |
| Integration tests | PASS | 3 files, 4 tests covering PostgreSQL health, transactional outbox, and migration checksum rejection |
| Browser E2E | PASS | 4 Chromium tests covering the shell and SHADOW/ECHO/SPECTRA routes |
| Migration safety | PASS | 1 SQL migration validated; repeated runs are no-op; changed applied checksum is rejected |
| OpenAPI | PASS | Redocly validation completes without warnings |
| Workspace build | PASS | 15/15 packages; `/`, `/shadow`, `/echo`, and `/spectra` generated |
| Local infrastructure | PASS | PostgreSQL, Redis, MinIO, Investigation Elasticsearch, OTel Collector, and Jaeger reachable |
| API runtime | PASS | Production build boots; live, ready, and system-info endpoints return HTTP 200 |
| Request context | PASS | `x-request-id` returned, propagated into system info, and emitted in structured request-completion logs |
| HTTP disclosure baseline | PASS | Express `X-Powered-By` header disabled |
| OpenTelemetry | PASS | System info returns a trace ID; Jaeger lists `platform-api`; a restricted synthetic marker does not appear in exported traces |
| Worker lifecycle | PASS | All three workers boot, remain alive, and stop cleanly on SIGINT |
| Secret scan | PASS | Pinned Gitleaks image scanned repository source; no leaks found |
| Dependency audit | PASS | No known production dependency vulnerabilities |
| CI definition | PASS statically | Pinned external action revisions; `actionlint` passes |
| Git repository | PASS | PR #1 merged as `87d9388` on GitHub `origin/main` |
| CI platform alignment | PASS | GitHub Actions detects the Engineering Quality workflow |
| CI push run | PASS | Run `33689747880`: Static, Integration, E2E, Security, and final `Quality Gate` all succeeded |
| CI pull request run | PASS | PR #2 run `33692145028`: Static, Integration, E2E, Security, and final `Quality Gate` all succeeded |
| Branch protection | PASS | Active ruleset `QC` targets the default branch; PR, resolved conversations, strict `Quality Gate`, deletion protection, and force-push protection verified via UI and GitHub API |
| Authoritative M0 checklist | PASS | Restored checklist read completely and reconciled line by line |
| Bootstrap integrity metadata | PASS with legacy note | Required-file status reconciled; supplied `manifest.json` remains an explicitly legacy v2.1 manifest |

## Runtime checks

The local compose stack is healthy on these endpoints:

- PostgreSQL: `127.0.0.1:5432`
- Redis: `127.0.0.1:6379`
- MinIO API: `127.0.0.1:19000`
- Investigation Elasticsearch: `127.0.0.1:9200`
- OTel Collector: `127.0.0.1:4317`
- Jaeger UI: `127.0.0.1:16686`

MinIO uses local host ports `19000` and `19001` because port `9000` was already
occupied. Container ports and service-to-service discovery remain unchanged.
The `intelligence-dev` MinIO bucket exists and reports anonymous access as
disabled. The compose file contains only Investigation Elasticsearch; it does
not contain a Resident Elasticsearch service.

Verified API responses:

- `GET /health/live` -> `200`, service status `ok`
- `GET /health/ready` -> `200`, PostgreSQL `up`
- `GET /api/v1/system/info` -> `200`, request ID and trace ID present

## Defects corrected during validation

- added the missing dependency-cruiser configuration and deployable-boundary
  rules;
- normalized Node ESM imports and fixed incorrect outbox/request-context paths;
- made workspace package exports resolve built JavaScript in production while
  retaining TypeScript development resolution;
- fixed exact-optional-property TypeScript errors in telemetry and error
  handling;
- added missing Redocly and PostgreSQL tooling dependencies;
- added a generated lockfile and least-privilege package build-script policy;
- corrected local compose environment loading and the MinIO host-port conflict;
- made all worker processes persistent and their shutdown handlers idempotent;
- upgraded vulnerable production dependencies and pinned the PostCSS override;
- converted the contract gate from an empty passing suite to executable API
  primitive contracts;
- added executable checksum-change rejection coverage and expanded browser E2E
  coverage to all three product foundation routes;
- replaced the previous no-op logging assertion with real JSON serialization
  redaction coverage and added query-free structured request completion logs;
- added the missing platform API environment example;
- added source-control, formatting, and Gitleaks exclusions for generated or
  local-only files;
- disabled the framework disclosure header;
- added Next.js-specific lint rules while keeping lint as an explicit required
  pre-build gate;
- added a GitHub Actions workflow with a stable final `Quality Gate` job and
  commit-pinned external actions;
- disabled setup-node's pre-Corepack package-manager cache discovery after PR #1
  exposed the ordering failure.

## Exit decision

All required M0 checks have passed, including the real pull-request workflow
and enforced default-branch ruleset. The M0 exit rule is satisfied, and P1 Auth,
Workspace, Case & Governance may begin after this final status update is merged.
