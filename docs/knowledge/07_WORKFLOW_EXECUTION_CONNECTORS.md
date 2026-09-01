# Workflow → Execution → Source Registry → Connector Runtime

## 1. Pipeline

```text
User Intent
→ Workflow
→ Execution
→ Source Registry
→ Connector Runtime
→ Source
→ Result
→ Evidence Ingestion
```

## 2. Workflow = Capability Intent

NodeDefinition harus source-agnostic sejauh mungkin.

Example:
```text
NodeDefinition: person-lookup:v1
requiredCapability: PERSON_LOOKUP
```

Bukan hard-code `resident-api`.

## 3. NodeDefinition

Contains:
- identity/version;
- category;
- typed inputs;
- outputs;
- configuration schema;
- required capability;
- execution policy;
- review policy;
- permission policy;
- presentation metadata.

## 4. NodeInstance

Instance capability dalam Investigation. Menyimpan definition reference, configuration, InputBinding, dan state.

## 5. InputBinding

Typed mapping:
```text
person.full_name → query.full_name
person.identifier.NATIONAL_ID → query.nationalId
```

Classification ikut diketahui agar Execution dapat mengetahui field sensitif yang akan dikirim ke connector.

## 6. Execution Snapshot

Saat user Run, Execution membekukan:
- input;
- configuration;
- access context;
- NodeDefinition version;
- limits;
- selected connector/version ketika resolved.

Edit Node setelahnya tidak mengubah Run history.

## 7. Run

Logical business execution.

Status user-facing:
- QUEUED
- RUNNING
- COMPLETED
- PARTIAL
- FAILED
- CANCELLED

## 8. ExecutionAttempt

Physical attempt.

```text
RUN-100
├── ATTEMPT-1 LOST
└── ATTEMPT-2 SUCCEEDED
```

Infrastructure retry = same Run, new Attempt.  
User/business retry = new Run dengan `retryOf`.

## 9. Run + Outbox

Atomic:
```text
BEGIN
  create Run
  create ExecutionOutbox
COMMIT
```

Dispatcher kemudian mengirim minimal `runId` ke job transport.

## 10. ExecutionPlan

Worker menerima immutable minimal contract:
```text
runId
attempt context
capability
connectorId/version
input
limits
accessContext
checkpoint
```

Plain secrets tidak boleh ada di plan/broker.

## 11. Source Registry

Tiga konsep berbeda:

### DataSourceDefinition
Business/governance identity source.

### ConnectorDefinition
Technical implementation akses source.

### Capability
Abstraksi kemampuan seperti PERSON_LOOKUP atau SOCIAL_ACTIVITY_COLLECTION.

Example:
```text
Node: Person Lookup
Capability: PERSON_LOOKUP
Connector: resident-api-v1
Source: Resident Data
```

## 12. Resident Data Integration

```text
Investigation Platform
→ Resident Connector
→ Hono Resident API
→ Resident Elasticsearch
```

Platform tidak direct query Elasticsearch dan tidak mengirim Elasticsearch DSL.

## 13. Connector Selection

Resolver mempertimbangkan:
- capability;
- user permission;
- Case classification;
- source classification;
- connector availability;
- source trust;
- execution profile;
- explicit source preference;
- future cost/budget policy.

## 14. Connector Runtime

Physical deployable `apps/connector-worker`.

Responsibilities:
- consume job;
- retrieve ExecutionPlan;
- execute connector;
- timeout;
- retry;
- rate limit;
- checkpoint/resume;
- cancellation;
- progress;
- result batching.

Tidak memiliki Case, Finding, Knowledge promotion, atau Entity creation logic.

## 15. Connector Result Envelope

Standardized envelope dapat memuat:
- sourceId;
- connectorId;
- externalRecordId;
- recordType;
- observedAt;
- payload/reference;
- metadata;
- identity hints;
- continuation token.

Result belum menjadi Entity.

## 16. Evidence Ingestion

Worker mengirim batch/reference ke Evidence internal API. Worker tidak direct SQL Evidence.

Bulk result tidak boleh menjadi giant broker message.

## 17. Progress

Use factual progress:
- stage;
- processed;
- produced;
- total if known.

Jangan fake percentage bila total tidak diketahui.

## 18. Checkpoint & Resume

Checkpoint opaque untuk Core dan versioned terhadap connector/checkpoint format.

Jika worker crash, Attempt baru dapat resume jika connector mendukung.

## 19. Cancellation

Cooperative cancellation pada safe points. Partial Evidence tetap dipertahankan dan Run dapat berakhir `PARTIAL / USER_CANCELLED`.

## 20. Error Taxonomy

Examples:
- SOURCE_TIMEOUT
- SOURCE_UNAVAILABLE
- SOURCE_RATE_LIMITED
- SOURCE_AUTH_FAILED
- SOURCE_PERMISSION_DENIED
- INVALID_SOURCE_RESPONSE
- UNSUPPORTED_QUERY
- SOURCE_POLICY_DENIED

Diklasifikasikan retryable/non-retryable.

## 21. Restricted Worker Pool

Example:
```text
connector.general
connector.restricted
```

Resident connector hanya tersedia pada restricted pool dengan network/secret access yang diperlukan.

## 22. Parent / Child Run

Multi-source capability:
```text
Parent Social Finder
├── X child Run
├── Instagram child Run
└── TikTok child Run
```

Parent dapat COMPLETED/PARTIAL/FAILED berdasarkan completion policy.

## 23. Manual & Scheduled Sama

Manual trigger dan Monitoring schedule menggunakan Execution engine yang sama; hanya trigger/actor context berbeda.

## 24. Invariants

- Workflow expresses capability, not connector implementation.
- Capability ≠ Connector.
- DataSource ≠ Connector.
- Run ≠ ExecutionAttempt.
- Run + Outbox atomic.
- At-least-once assumed; idempotency required.
- Connector Runtime never creates canonical Knowledge.
- Secrets not stored in broker/Run payload.
- Every source result preserves source + connector + Run provenance.
