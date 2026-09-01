# API Implementation Guidelines

## 1. Surfaces

```text
/api/v1/*       public client API
/internal/v1/*  service-to-service
/api/v1/realtime/events  SSE
```

## 2. Mutation ownership

Canonical writes follow domain modules.

Do not create:
```text
/shadow/create-person
/echo/save-relationship
/spectra/save-profile
```

Use:
```text
/subjects
/candidates/.../actions/resolve
/entities
/relationships
/monitoring-targets
```

Experience namespaces are primarily read models.

## 3. Long-running operations

Return:
```http
202 Accepted
```

with canonical operation reference:
```json
{
  "operation": {
    "type": "RUN",
    "id": "...",
    "status": "QUEUED"
  }
}
```

Do not hold HTTP request open for connector/analysis completion.

## 4. Error contract

Stable machine-readable code:
```json
{
  "error": {
    "code": "ACCESS_REASON_REQUIRED",
    "message": "...",
    "requestId": "..."
  }
}
```

Never expose:
- SQL error;
- stack trace;
- source secret;
- raw restricted response.

## 5. Idempotency

Important POST/command accepts:
```http
Idempotency-Key: <opaque client-generated id>
```

Same key + same normalized request must return equivalent result.
Same key + conflicting request must return a conflict.

## 6. Concurrency

Mutable canonical resources expose:
- `revision`;
- `ETag`.

Client mutation uses:
```http
If-Match: "<revision>"
```

Stale update:
`412 Precondition Failed`.

## 7. Pagination

Default:
```text
?limit=50&cursor=...
```

Response:
```json
{
  "items": [],
  "page": {
    "nextCursor": "...",
    "hasMore": true
  }
}
```

Cursor is opaque.

## 8. Authorization

Every resource read/write performs server-side authorization.

For confidentiality, a denied resource may intentionally return `404` when existence itself is restricted.

## 9. Sensitive fields

Return explicit visibility:
```text
FULL
MASKED
MATCH_ONLY
HIDDEN
```

Do not make frontend infer policy from null values.

## 10. Search

Search is a platform query abstraction.

No direct Elasticsearch DSL from browser.
No relevance score interpreted as identity confidence.

## 11. OpenAPI

- API contract updated in same PR.
- operationId stable and descriptive.
- request/response examples for critical endpoints.
- enum additions reviewed for client compatibility.
- breaking changes require version strategy/ADR.

## 12. Internal API

Worker must prove:
- service identity;
- valid Run/Attempt relation;
- allowed transition.

Internal API is not a shortcut around domain validation.
