# Security Baseline

The detailed baseline is authoritative at:

`docs/knowledge/23_SECURITY_ENGINEERING_BASELINE.md`

Additional rules:

- secrets never belong in source control, browser payloads, logs, outbox, or queue bodies;
- restricted PII must be server-authorized and rendered according to FULL/MASKED/MATCH_ONLY/HIDDEN;
- `leaked-service` is accessed only through its Hono API boundary; never directly through its Elasticsearch store;
- source data remains untrusted;
- source governance/retention must be explicit;
- production object storage is private;
- connector network egress is allowlisted/reviewed;
- source response persistence follows source-specific policy.
