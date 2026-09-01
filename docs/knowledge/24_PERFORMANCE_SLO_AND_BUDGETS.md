# Performance, SLO & Resource Budgets

These are **initial engineering budgets**, not contractual guarantees. Revise with benchmark evidence via ADR.

## 1. User-facing latency budgets

Measured server-side unless stated otherwise.

| Operation | Initial target |
|---|---:|
| Simple canonical GET (Case/Subject/Entity) | p95 ≤ 300 ms |
| Normal synchronous mutation | p95 ≤ 500 ms |
| Complex experience read model | p95 ≤ 800 ms |
| Investigation search | p95 ≤ 1,000 ms |
| Long-running command acknowledgement (`202`) | p95 ≤ 500 ms |
| SSE event delivery after committed state/event | p95 ≤ 2 s under normal load |

External connector latency is not included in synchronous API SLO because source access runs asynchronously.

## 2. Reliability budgets

Initial service targets:
- Platform API availability target: 99.9% monthly excluding planned maintenance.
- Canonical business mutation must not depend on Elasticsearch availability.
- Queue/broker outage must not lose committed Run requests because Outbox is source of dispatch truth.
- Search projection may be temporarily stale/degraded without corrupting canonical data.

## 3. Query budgets

- Default collection page: 50 items unless endpoint requires another value.
- Server maximum must be explicit.
- No unbounded `GET all`.
- High-volume activity/evidence always cursor-paginated.
- Focused graph neighborhood queries preferred over entire Case graph loads.
- Detect and block N+1 queries in common read paths.
- Inspect `EXPLAIN`/query plan for critical endpoints before production.

## 4. Payload budgets

- Public API responses should normally remain < 1 MiB.
- Large evidence/media/export data uses object references/signed URLs.
- Queue payload should normally contain identifiers/metadata only, not bulk evidence.
- Internal ingestion uses bounded batches; use object storage reference above the configured safe batch threshold.
- Every connector response has maximum accepted body size.

## 5. Worker/backpressure

- Per-connector concurrency limit.
- Per-credential/source rate limit.
- Bounded retry count.
- Exponential/backoff respecting `Retry-After`.
- Queue depth and oldest-job age monitored.
- Scheduler must not enqueue duplicate due work repeatedly.
- Overload response should degrade/queue, not consume unbounded memory.

## 6. Database

Watch:
- pool saturation;
- lock waits;
- slow queries;
- transaction duration;
- row growth;
- outbox lag.

Guidelines:
- keep transactions short;
- do not hold DB transaction across external HTTP call;
- batch inserts for evidence membership/ingestion;
- partition only after measured need and data-volume evidence.

## 7. Frontend performance

Initial goals:
- product route code splitting;
- virtualize large activity lists;
- lazy load graph details;
- do not fetch all Evidence to render an aggregate edge;
- TanStack Query cache keys include Case/resource scope;
- avoid rerendering entire React Flow graph for local inspector changes;
- use server aggregation for high-volume metrics.

## 8. Benchmark datasets

Maintain representative synthetic datasets:
- small Case: 10 entities / 100 evidence;
- medium Case: 1k entities / 100k evidence;
- large test Case: 10k+ entities / 1M+ evidence references where feasible.

Never benchmark with real restricted PII.

## 9. Release rule

A performance optimization is accepted only if:
- correctness/security unchanged;
- benchmark is reproducible;
- before/after metrics recorded;
- complexity is justified.

A release with major regression on a critical path requires documented exception or fix.
