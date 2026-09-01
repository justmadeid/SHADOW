# Test Strategy

## 1. Test layers

### Unit
Domain invariants and pure policies:
- Subject state transitions;
- Candidate resolution rules;
- knowledge scope/promotion;
- run/attempt state machines;
- dataset completeness;
- alert lifecycle;
- hypothesis/finding lifecycle.

### Module integration
Real persistence + module application layer:
- repositories;
- transactions;
- constraints;
- authorization hooks;
- outbox writes;
- idempotency;
- optimistic concurrency.

### Contract tests
- OpenAPI request/response schemas;
- connector SDK;
- internal worker API;
- RealtimeEvent;
- ResourceRef/DeepLinkTarget;
- Hono Resident API adapter contract.

### Worker integration
- duplicate queue delivery;
- lost attempt;
- heartbeat timeout;
- checkpoint resume;
- cancellation;
- retryable/non-retryable errors;
- ingestion batch replay.

### End-to-end
Reference flows from `11_REFERENCE_FLOWS.md`.

Minimum E2E:
1. Case → Person Lookup → Candidate → Entity.
2. Existing Target reuse.
3. Social/news collection → Evidence → Dataset → Analysis.
4. Candidate B → SHADOW → Entity B → ECHO relation.
5. Hypothesis → Finding → Review.
6. Knowledge revoke affecting a Case.
7. Restricted user denied cross-case data.

## 2. Security tests

Must include:
- IDOR;
- cross-workspace;
- cross-case;
- field masking;
- reason-for-access required;
- source connector denied;
- raw evidence denied;
- expired/revoked permission;
- notification/deep-link authorization;
- XSS/untrusted source rendering;
- SSRF test cases for connectors;
- large payload/rate limit;
- audit presence on sensitive actions.

## 3. Property/state-machine tests

Useful for:
- Run states;
- Attempt states;
- Finding lifecycle;
- Alert lifecycle;
- entity merge canonical resolution;
- idempotency under repeated commands.

## 4. Data integrity tests

Assertions:
- Candidate cannot become Entity without ResolutionDecision path.
- RESOLVED Subject references canonical active/merged-resolvable Entity.
- Workspace Knowledge promotion retains source lineage.
- AnalysisResult references immutable DatasetSnapshot.
- Finding support links preserve referenced revision where required.
- SourceRecord provenance includes Run + source + connector.

## 5. Test data

- synthetic only for CI;
- no production restricted PII;
- factories generate classification-aware objects;
- every test creates isolated Workspace/Case unless explicitly testing cross-case behavior.

## 6. Performance tests

Separate suites:
- API latency;
- search;
- evidence ingestion;
- queue throughput;
- graph read model;
- SSE connection/event delivery.

Performance tests must not replace correctness tests.

## 7. Regression requirement

Every production bug involving:
- access control;
- data corruption;
- duplicate processing;
- incorrect resolution;
- evidence loss;
- retry behavior

must receive an automated regression test before closure.
