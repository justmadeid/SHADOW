# Local Development & Debugging Runbook

## Recommended local dependencies

- PostgreSQL
- Redis/BullMQ
- S3-compatible object storage
- Investigation Elasticsearch
- telemetry collector/backend as configured
- Platform API
- Platform Web
- connector-worker
- intelligence-worker
- indexing-worker

Resident Hono API is an external existing service and should have a safe development/test endpoint or stub contract.

## Startup order

1. dependencies;
2. DB migrations;
3. Platform API;
4. workers;
5. Platform Web.

Workers may start before external connector availability; source health should degrade independently.

## Debugging an API request

Capture:
- requestId;
- traceId;
- resource ID;
- Case ID if permitted.

Check:
1. auth;
2. governance decision;
3. domain error;
4. DB transaction;
5. event/outbox.

## Debugging a Run

Capture `runId`.

Inspect:
1. Run state;
2. input/config/access snapshot;
3. outbox dispatch;
4. queue job;
5. ExecutionAttempts;
6. heartbeat/lease;
7. connector/analysis error;
8. checkpoint;
9. evidence/result batch;
10. terminal result.

## Debugging stale UI

Determine if resource is:
- canonical DB read;
- search projection;
- experience projection.

If projection:
- check projectionRevision/isStale;
- indexing worker;
- outbox lag.

Do not “fix” stale projection by writing directly to Elasticsearch.

## Safe local test data

Use synthetic identities only.
Do not copy production Resident records into local developer databases.

## Reset

Local reset scripts may clear development data but must never be reusable against production configuration without explicit safety guard.
