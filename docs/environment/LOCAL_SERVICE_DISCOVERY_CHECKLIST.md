# Local Service Discovery Checklist

Use this only **after M0 is Engineering Ready**.

## General process

For each sibling service:

1. inspect README/docs;
2. inspect package manifest/runtime;
3. inspect route definitions/OpenAPI if available;
4. inspect configuration/env examples;
5. inspect authentication middleware;
6. inspect request validators;
7. inspect response mappers;
8. inspect pagination/limits/timeouts;
9. inspect error handling;
10. inspect tests/examples;
11. do not change the service;
12. do not execute real-person lookups just to discover the contract.

## Record these fields

```text
Service name
Repository/path
Runtime/stack
Start command
Base URL / port
Authentication
Endpoints
Capabilities
Request schema
Response schema
Pagination
Timeout
Rate limit
Error schema
External dependencies
Data source provenance
Data classification
Raw response policy
Retention
Security concerns
Recommended ConnectorDefinition
Recommended CapabilityDefinition
Open questions
```

## `leaked-service` / Hono Person Lookup clarification

`leaked-service` is the same technical service previously referred to as the Resident Hono API.

During contract discovery:

- inspect it read-only;
- confirm the Hono routes and actual Elasticsearch dependency;
- do not create a second duplicate connector;
- do not bypass it and query Elasticsearch directly;
- document the actual dataset provenance and permitted-use/retention policy;
- do not execute real-person queries only to discover the API contract.

The service/repository name alone must not be used as the sole basis for a governance conclusion.

## `user-scanner` semantic gate

Determine whether a positive response means:
- account definitely exists;
- provider heuristic indicates presence;
- registration endpoint behavior suggests presence;
- result is ambiguous.

The normalized observation must preserve that uncertainty.

## `twitter-scrapper-api`

Deferred. Do not spend M0/P1 effort reverse-engineering this unless explicitly requested.
