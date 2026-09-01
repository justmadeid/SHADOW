# Bootstrap Status v3.1

This package now includes the actual repository scaffold that was missing from the earlier documentation-only pack.

Included:
- pnpm workspace + Turborepo;
- platform-web;
- platform-api;
- connector-worker;
- intelligence-worker;
- indexing-worker;
- shared packages;
- P0 architecture boundary tooling;
- local infrastructure compose;
- test foundation;
- DB transaction foundation;
- RequestContext;
- PII-safe logging foundation;
- OpenTelemetry foundation;
- API primitives;
- health/readiness;
- transactional outbox;
- CI quality pipeline;
- full authoritative architecture documents;
- current SHADOW product/design documents.

Runtime M0 success is **not pre-claimed**. Codex must execute the gates in the real environment and fix any integration defects found.

## Initial lockfile note

This artifact intentionally does not pre-generate `pnpm-lock.yaml` because package resolution must
be proven in the real developer environment.

First bootstrap:

```bash
pnpm install
```

Review the resolved dependency graph, run M0 gates, then commit the generated lockfile.

After the lockfile exists, CI must use:

```bash
pnpm install --frozen-lockfile
```
