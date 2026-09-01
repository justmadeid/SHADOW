# Threat Model Baseline

## Assets

High-value assets:
- restricted resident identifiers;
- Case membership and confidential context;
- Evidence and raw payload;
- Entity resolution decisions;
- Workspace Knowledge;
- approved Findings;
- audit trail;
- connector credentials;
- object-store artifacts;
- execution plans.

## Trust boundaries

```text
Browser
  ↓
Public Platform API
  ↓
Canonical PostgreSQL / Object Store / Search Projection
  ↓
Outbox / Redis-BullMQ
  ↓
Workers
  ↓
Internal API
  ↓
External/Internal Data Sources
```

Special boundary:
```text
Restricted Connector Worker
→ Hono Resident API
→ Resident Elasticsearch
```

## STRIDE-style considerations

### Spoofing
- stolen user token;
- forged worker/service identity;
- forged queue job.

Mitigations:
OIDC, service auth, job-plan verification, short-lived credentials, least privilege.

### Tampering
- evidence batch replay/modification;
- finding/knowledge silent edit;
- outbox manipulation.

Mitigations:
idempotency, immutable history/revisions, checksums/artifact refs, audit, DB constraints.

### Repudiation
- analyst denies restricted lookup or merge.

Mitigations:
durable audit with actor/context/outcome/reason.

### Information disclosure
- cross-case Entity context leak;
- raw NIK in logs;
- search snippet leak;
- signed URL too broad.

Mitigations:
contextual governance, field policy, redaction, scoped search, expiring object access.

### Denial of service
- expensive search;
- connector flood;
- oversized payload;
- queue explosion.

Mitigations:
limits, pagination, rate limiting, concurrency, backpressure, query budgets.

### Elevation of privilege
- frontend hidden button treated as security;
- user passes arbitrary connectorId;
- worker uses broad service account.

Mitigations:
server policy, eligible connector resolver, constrained ExecutionPlan, service least privilege.

## Domain-specific safety threats

### Wrong identity merge
Impact: contaminates all Cases using canonical Entity.

Controls:
- human review for risky merge;
- explainable signals/conflicts;
- audit;
- reversible merge.

### Automated false attribution
Impact: machine output treated as fact.

Controls:
- Candidate ≠ Entity;
- Analysis ≠ Knowledge;
- relationship candidate requires review;
- Finding human review.

### Cross-case contamination
Impact: Case B sees Case A's sensitive evidence.

Controls:
- Entity reusable, Evidence case-scoped;
- explicit cross-case permissions;
- read-model filtering.

### Source trust confusion
Impact: authoritative source score interpreted as identity certainty.

Controls:
separate source trust, search relevance, identity confidence.

## Review cadence

Threat model must be revisited when:
- new connector/source;
- new file upload;
- LLM/AI capability;
- cross-workspace/cross-case sharing;
- export/report;
- new public ingress;
- new worker network boundary;
- major auth change.
