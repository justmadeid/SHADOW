# Cross-Cutting Architecture

## 1. Components

- Authentication
- Request Context
- Governance
- Audit
- Notification
- Realtime
- Observability

## 2. Authentication vs Governance

Authentication menjawab **siapa actor ini**.  
Governance menjawab **apakah actor ini boleh melakukan action tertentu terhadap resource dalam context tertentu**.

Authentication bukan authorization.

## 3. RequestContext

Minimal:
```text
requestId
traceId
userId
workspaceId
caseId?
investigationId?
reasonForAccess?
clientApplication?
```

Context dibawa seperlunya ke Run, Audit, provenance, dan internal calls.

## 4. Governance Model

Tidak hanya RBAC. Tiga kategori policy:

### Action Policy
- boleh merge Entity?
- boleh promote Knowledge?
- boleh start Monitoring?

### Data Policy
- boleh melihat full NIK?
- boleh raw payload disimpan?
- boleh Evidence diexport?

### Context Policy
- member Case?
- reason-for-access wajib?
- boleh cross-case disclosure?

## 5. Permission to Use ≠ Permission to View

User dapat diberi hak `MATCH_ONLY` terhadap National ID tanpa `FULL` view.

Possible field visibility:
- FULL
- MASKED
- MATCH_ONLY
- HIDDEN

## 6. Classification

- PUBLIC
- INTERNAL
- SENSITIVE
- RESTRICTED

Classification memengaruhi authorization, masking, persistence, indexing, export, retention, worker routing, logging, dan backup.

## 7. PolicyEnforcer

Domain melakukan:
```text
authorize(action, resource, context)
```

Tetapi business validity/invariant tetap milik domain. Governance tidak boleh menjadi God Domain.

## 8. Cross-Case Governance

Permission terpisah:
- DISCOVER_ENTITY_EXISTENCE
- VIEW_CROSS_CASE_CONTEXT
- VIEW_CROSS_CASE_EVIDENCE

Entity Registry dapat membantu dedupe tanpa membocorkan nama Case/evidence lain.

## 9. Audit

Audit ≠ application logs.

Audit menjawab:
- actor;
- action;
- resource;
- case/context;
- outcome;
- timestamp.

Append-only.

Critical actions:
- restricted source access;
- sensitive identifier view;
- candidate resolution;
- Entity merge/split;
- Knowledge promote/revoke;
- Finding approval;
- Evidence export;
- permission change.

## 10. Sensitive Audit Data

Jangan memasukkan raw restricted values by default. Simpan identifier type, resource ref, fingerprint ref bila sesuai policy, reason, dan outcome.

Critical audit intent harus durable dan idealnya transactional/outbox-backed.

## 11. Notification

Notification adalah persistent user attention state.

Tidak semua domain event menjadi Notification.

Notification memiliki ResourceRef/DeepLinkTarget sehingga user dapat diarahkan ke resource yang relevan.

Permission tetap diperiksa ulang ketika resource dibuka.

## 12. Notification vs IntelligenceHighlight

`IntelligenceHighlight` = hal penting terhadap Case.  
`Notification` = hal yang perlu disampaikan ke user tertentu.

Satu Highlight dapat menghasilkan 0..N Notifications.

## 13. Realtime

MVP menggunakan SSE untuk:
- Run progress/status;
- Candidate ready;
- Dataset ready;
- Analysis completed;
- Alert raised;
- Notification created;
- Knowledge changed.

Realtime bukan source of truth. Reconnect harus dapat refetch canonical state.

## 14. Realtime Security

Event hanya membawa minimal data seperti resourceId/revision/status. Jangan broadcast full sensitive object.

Server-side authorization filtering wajib; jangan filter di browser saja.

## 15. Collaboration Realtime

Future ECHO presence/cursor/shared canvas edit adalah concern berbeda dan dapat menggunakan WebSocket/collaboration protocol tersendiri.

## 16. Observability

Tiga pilar:
- Logs
- Metrics
- Traces

OpenTelemetry direkomendasikan sejak awal.

Correlation IDs:
- traceId;
- requestId;
- runId;
- attemptId.

## 17. PII-safe Logging

Structured log example:
```text
event = connector.request.failed
runId
connectorId
errorCode
durationMs
```

Hindari raw NIK, phone, email, full resident response, dan sensitive query values.

## 18. Metrics

Examples:
- request latency/error rate;
- outbox lag;
- queue depth;
- run duration/retry rate;
- connector latency/rate-limit hits;
- evidence throughput/dedupe ratio;
- analysis duration;
- monitoring schedule lag;
- alert count.

Hindari high-cardinality labels seperti caseId/entityId/userId.

## 19. Distinction of Streams

| Stream | Makna |
|---|---|
| Audit | siapa melakukan apa |
| Observability | sistem teknis sedang apa |
| Notification | user perlu diberitahu apa |
| Intelligence Feed | intelligence penting apa yang terjadi pada Case |
| Realtime | cara update cepat sampai UI |

## 20. Retention & Export

Retention lifecycle dapat mencakup:
- ACTIVE
- CLOSED
- RETENTION_HOLD
- ARCHIVED
- ELIGIBLE_FOR_PURGE
- PURGED

Export adalah high-risk operation dan perlu policy untuk permission, classification, redaction, watermark, serta audit.

## 21. Reference Request Lifecycle

```text
Incoming Request
→ Authentication
→ RequestContext
→ Governance Authorization
→ Domain Command
→ Transaction
  ├─ Business Change
  ├─ Outbox
  └─ Critical Audit Intent
→ Commit
→ Events
  ├─ Notification
  ├─ Realtime
  ├─ Search Projection
  └─ Other reactions
```

Observability berjalan sepanjang lifecycle.
