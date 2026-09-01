# Connector Development Guide

## Goal

A Connector translates a capability-specific ExecutionPlan into source calls and standard result envelopes.

It does **not**:
- create Entity;
- create Knowledge;
- approve Finding;
- query Case repositories;
- own source-of-truth business state.

## Required connector metadata

- connector ID/version;
- Data Source ID;
- supported capabilities;
- execution profile;
- timeout;
- concurrency/rate policy;
- checkpoint support;
- incremental support;
- credential reference type;
- source classification/persistence policy.

## Implementation structure

```text
packages/connectors/<connector>/
├── src/
│   ├── connector.ts
│   ├── client.ts
│   ├── schemas.ts
│   ├── mapper.ts
│   └── errors.ts
└── tests/
```

## Execution contract

Connector receives:
- run/attempt identity;
- authorized inputs;
- access context;
- checkpoint;
- cancellation signal;
- progress reporter;
- credential provider.

It emits:
- bounded result batches or artifact refs;
- external record identity;
- observedAt;
- continuation/checkpoint;
- standardized error.

## Validation

Validate:
- allowed capability;
- required input;
- field length/type;
- unsupported source option;
- date range;
- maximum item limit.

Do not forward arbitrary unknown query parameters to source.

## Security

- destination allowlist;
- no caller-provided arbitrary base URL;
- no secrets in errors/logs;
- timeout/body limit;
- redirect policy;
- source-specific auth;
- restricted connectors only in permitted execution profile.

## Reliability

- honor cancellation at safe points;
- checkpoint after stable page/batch;
- map transient/permanent errors;
- bounded retries;
- never assume exactly-once;
- result identity must support dedupe.

## Resident connector rule

```text
Investigation Platform
→ Resident Connector
→ Hono Resident API
→ Resident Elasticsearch
```

Never:
```text
Investigation Platform
→ Resident Elasticsearch
```

Hono owns source-side search semantics and field controls.

## Connector contract tests

Each connector must prove:
- valid input;
- invalid input;
- timeout;
- 401/403;
- 429 + Retry-After;
- 5xx;
- malformed source response;
- duplicate record identity;
- pagination;
- cancellation;
- checkpoint resume if supported;
- PII-safe logs.
