# Engineering Standards

## 1. Priority order

When concerns conflict, use this order unless an ADR says otherwise:

1. Security / confidentiality / authorization correctness
2. Data integrity and provenance
3. Domain correctness
4. Reliability / idempotency
5. Performance / resource efficiency
6. Maintainability / module boundaries
7. Developer ergonomics
8. Cosmetic convenience

Never trade access-control correctness for performance.

## 2. General code rules

- TypeScript strict mode.
- No `any` in domain/application contracts unless isolated at untrusted boundary and validated immediately.
- Validate every external input at HTTP, queue, connector and file boundaries.
- Prefer explicit domain types/enums over magic strings.
- Use UTC timestamps internally; format local time only at presentation.
- UUIDv7/opaque IDs for canonical resources.
- `revision` means optimistic concurrency state; `version` means semantic definition/model version.
- No hidden fallback from real data to mock data in production code.
- No silent catch that converts failure to success/empty result.
- Domain errors have stable codes.
- Avoid giant generic service classes; prefer use-case handlers/application facades.

## 3. Backend module rule

Cross-module code may import only the public entry point/facade of another module.

Forbidden:
- another module's repository;
- another module's ORM schema/table;
- another module's infrastructure adapter;
- direct cross-module SQL for mutations.

Complex read models may use dedicated projection/query infrastructure but must remain rebuildable and read-only.

## 4. Transactions

Use transactions for atomic invariants only.

Good:
```text
ResolutionDecision
+ Entity create/link
+ Subject resolve
```

Do not create huge transactions spanning:
- external API calls;
- queue waits;
- analysis;
- search indexing.

Use Outbox after canonical state commit.

## 5. Async work

Assume at-least-once delivery.

Therefore:
- handlers idempotent;
- batches have idempotency keys;
- Run separate from Attempt;
- external calls have timeout;
- retries bounded;
- cancellation cooperative;
- progress honest;
- large data passed by reference/batch.

## 6. API implementation

- Public `/api/v1`.
- Internal `/internal/v1`.
- `202` for long-running accepted work.
- Cursor pagination for high-volume collections.
- `ETag/If-Match` or expected revision for mutable canonical resources.
- `Idempotency-Key` for important POST/commands.
- Server-side authorization on every resource access.
- Sensitive field visibility comes from policy, never frontend-only masking.

## 7. Frontend

- Server state: TanStack Query.
- Product-local interaction state: local state/Zustand only where needed.
- No duplicate API response cache in global stores.
- No product internal imports across SHADOW/ECHO/SPECTRA.
- Do not render untrusted source HTML without safe sanitization/isolated rendering.
- Large graph/list views require virtualization/lazy loading where appropriate.
- Realtime event triggers targeted cache update/refetch; it is not source of truth.

## 8. Database

- Index foreign keys and actual query predicates after inspecting query plans.
- Avoid unbounded scans.
- No JSON blob as substitute for a modeled core domain relation.
- JSON is acceptable for source-specific payload/reference/config when schema/version is explicit.
- Migrations forward-compatible with rolling deploy whenever possible.
- Destructive migration requires explicit migration plan/ADR.
- Do not rely on application-only uniqueness for identity-critical records; use DB constraints where possible.

## 9. Elasticsearch

- Projection only.
- No source-of-truth mutation exclusively in ES.
- No public ES DSL passthrough.
- Search results filtered by governance scope before disclosure.
- Index version/mapping changes are rebuildable.
- `_score` is relevance, not identity confidence.

## 10. Security

- Secrets never committed or logged.
- No browser token forwarded to workers.
- Restricted connectors isolated.
- PII-safe logs by default.
- Principle of least privilege for DB, object store, queue, source connector.
- Raw external content treated as untrusted.

## 11. Performance

- Measure before complex optimization.
- Prevent N+1 queries.
- Prefer batch operations.
- Paginate every potentially high-volume API.
- No broker message carrying large evidence dataset.
- Avoid rehydrating entire Case graph when only a focused neighborhood is required.
- Cache only rebuildable/read data; authorization must remain correct.
