# CODEX START HERE — Bootstrap v3.1

This directory is the **actual `intelligence-platform` repository scaffold**.

It is not a documentation-only pack.

## Current objective

Complete:

> M0 — Engineering Ready

Do not implement P1 business domains or SHADOW feature screens until M0 passes.

## First reading

1. `AGENTS.md`
2. `SECURITY.md`
3. `docs/engineering/M0_ENGINEERING_READY_GATE.md`
4. mandatory architecture docs referenced by `AGENTS.md`

The previously missing authoritative files are now included under `docs/knowledge/`.

## Repository included

```text
apps/
├── platform-web
├── platform-api
├── connector-worker
├── intelligence-worker
└── indexing-worker

packages/
├── contracts
├── api-client
├── ui
├── canvas-kit
├── auth
├── connector-sdk
├── database
├── observability
├── config
└── testing
```

Do not create another monorepo.

## M0

Inspect the actual files and validate/fix:

```text
pnpm install
architecture boundaries
typecheck
lint / format
tests
local Docker infrastructure
database migrations
platform-api boot
platform-web boot
worker boot/shutdown
health/live
health/ready
system/info
RequestContext
PII-safe logging
OpenTelemetry
Transactional Outbox
OpenAPI
security gates
build
CI
```

When a gate fails:
1. find root cause;
2. verify fix against architecture;
3. make smallest correct fix;
4. add regression coverage if appropriate;
5. rerun;
6. do not weaken gates to make them green.

Create:

`docs/engineering/M0_VALIDATION_REPORT.md`

## Source clarification

`leaked-service` and the previously named Hono Person Lookup / Resident API are the same technical service.

```text
Platform
→ Person Lookup Connector
→ leaked-service (Hono)
→ Elasticsearch
```

Never direct Elasticsearch access.
Never create two connectors for that one service.

## SHADOW

SHADOW is the first product experience to prioritize after foundations, but implementation remains domain-first.

Approved design through:

```text
Target Profile v2
Adaptive Investigation Stage shared behavior
Investigation Resource Canvas v1
```

Pending detailed design:

```text
Activity Timeline
Geospatial Map
```

Do not invent final Timeline/Map behavior.
