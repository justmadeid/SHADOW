# Code Review Checklist

## Architecture
- [ ] Correct owning module?
- [ ] Any forbidden cross-module repository/table import?
- [ ] Any SHADOW/ECHO/SPECTRA internal cross-import?
- [ ] Any new source of truth duplicated in read model/UI?
- [ ] Any new decision requiring ADR?

## Domain
- [ ] Candidate/Entity distinction preserved?
- [ ] Evidence/Truth distinction preserved?
- [ ] Analysis/Knowledge distinction preserved?
- [ ] Case/Workspace scope correct?
- [ ] History/revision preserved?

## API
- [ ] OpenAPI updated?
- [ ] Stable error code?
- [ ] Authorization server-side?
- [ ] Idempotency/revision handled?
- [ ] Pagination/limits?
- [ ] 202 for long-running work?

## Security
- [ ] Cross-workspace/case access tested?
- [ ] Sensitive field policy?
- [ ] PII absent from logs/traces?
- [ ] External content treated as untrusted?
- [ ] New egress/source reviewed?
- [ ] Secrets safe?

## Reliability
- [ ] Transaction boundary short and correct?
- [ ] Async path idempotent?
- [ ] Duplicate delivery safe?
- [ ] Retry bounded?
- [ ] Cancellation/partial result correct?
- [ ] Failure cannot leave invalid canonical state?

## Performance
- [ ] Any unbounded query/list?
- [ ] N+1?
- [ ] Correct indexes/query plan?
- [ ] Large payload avoided/batched?
- [ ] UI fetch volume appropriate?

## Tests
- [ ] Domain unit?
- [ ] Integration?
- [ ] Negative auth?
- [ ] Contract?
- [ ] Regression?
- [ ] Reference flow affected?

## Operations
- [ ] Useful structured telemetry?
- [ ] Critical audit?
- [ ] Realtime minimal and authorized?
- [ ] Migration/release rollback safe?
