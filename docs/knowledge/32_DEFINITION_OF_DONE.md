# Definition of Done

A feature/task is complete only when all applicable items pass.

## Domain
- [ ] Canonical owner is correct.
- [ ] Domain invariant is implemented in domain/application layer.
- [ ] No duplicate source of truth introduced.
- [ ] Correction/history semantics preserve provenance.

## API/contracts
- [ ] OpenAPI/schema updated.
- [ ] Stable error codes.
- [ ] Idempotency defined for critical POST.
- [ ] Optimistic concurrency defined for mutable canonical resource.
- [ ] Pagination/limits defined for collections.

## Security
- [ ] Authentication/authorization server-side.
- [ ] Workspace/Case isolation tested.
- [ ] Classification handling correct.
- [ ] Sensitive field output policy tested.
- [ ] Logs/metrics/traces contain no prohibited PII.
- [ ] External-source/connector abuse case reviewed.

## Reliability
- [ ] Transaction boundary explicit.
- [ ] Async handler idempotent.
- [ ] Retry/cancel behavior defined where relevant.
- [ ] No external call inside long DB transaction.
- [ ] Failure does not leave partial canonical invariant.

## Performance
- [ ] No unbounded read.
- [ ] No obvious N+1.
- [ ] Query/index reviewed for expected scale.
- [ ] Bulk data batched/referenced.
- [ ] UI does not fetch unnecessary high-volume detail.

## Testing
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] Contract tests when boundary changed.
- [ ] Security negative tests.
- [ ] Regression test for fixed bug.
- [ ] Relevant reference E2E flow remains passing.

## Observability & audit
- [ ] Structured operational telemetry.
- [ ] Correlation IDs preserved.
- [ ] Critical sensitive action produces durable audit.
- [ ] Realtime event contains minimal data.

## Documentation
- [ ] Relevant architecture/knowledge updated if semantics changed.
- [ ] ADR added for a new architecture decision.
- [ ] Backlog/task status updated.

## Release
- [ ] Migration deployment order safe.
- [ ] Rollback impact understood.
- [ ] No Critical/High unresolved security or architecture gate defect.
