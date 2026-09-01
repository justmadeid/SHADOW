# Database & Migration Guidelines

## 1. Canonical store

PostgreSQL is the canonical transactional store for:
- Case/Investigation;
- Subject/Resolution;
- Entity Registry;
- Knowledge;
- Evidence metadata;
- Dataset metadata/membership references;
- Analysis metadata/results where structured/small;
- Monitoring;
- Hypothesis/Finding;
- Governance/Audit metadata.

Elasticsearch remains projection/search.

## 2. Logical ownership

Tables must have a documented owning module.

Suggested naming/schema convention may reflect:
```text
workspace
case
investigation
subject
resolution
entity_registry
knowledge
execution
evidence
dataset
analysis
monitoring
intelligence
governance
audit
```

Physical PostgreSQL schemas are optional; ownership is not.

## 3. Cross-module rule

A module may not directly mutate tables owned by another module.

Use:
- facade/application API;
- orchestration transaction;
- domain/integration events.

Dedicated read projections may join canonical tables only when explicitly documented and read-only.

## 4. Migrations

Prefer expand/contract:

1. Add backward-compatible column/table/index.
2. Deploy code that writes/reads compatible shape.
3. Backfill if needed.
4. Switch reads.
5. Remove old shape in later release.

Avoid:
- rename/drop + code change in one risky deployment;
- long blocking index creation on large table;
- destructive migration without backup/rollback plan.

## 5. Constraints

Use database constraints for:
- unique stable identifiers where policy/semantics allow;
- FK integrity within owned model;
- valid one-to-one relationships;
- idempotency key uniqueness;
- outbox/event identity;
- version/revision checks where appropriate.

Application validation does not replace DB integrity.

## 6. Indexing

Create indexes from real query requirements.

Review:
- Case scoped filters;
- workspace Entity lookup;
- candidate status queues;
- Run status/time;
- outbox undispatched;
- Evidence external source identity;
- Dataset membership;
- Monitoring due schedules;
- notification unread.

Measure write amplification before adding many indexes.

## 7. Sensitive identifiers

Do not index encrypted ciphertext for lookup.

Use policy-approved comparison fingerprint/HMAC where exact match is needed.

Do not place raw restricted value in:
- generic JSON search column;
- ES projection;
- audit;
- logs.

## 8. JSON columns

Acceptable for:
- connector/source-specific metadata;
- versioned configuration;
- raw-ish normalized envelope metadata;
- non-query-heavy analysis detail.

Not acceptable as excuse to avoid modeling:
- Entity identifiers;
- Claims/Relationships;
- Candidate decisions;
- Evidence provenance;
- Finding review.

## 9. Backups

Canonical recovery priority:
1. PostgreSQL.
2. Object storage.
3. Secret/config infrastructure.
4. Elasticsearch rebuilt from canonical/outbox/projection events where practical.
5. Redis/BullMQ treated as operational transport/state, not sole canonical truth.

Restore drill is required before production.
