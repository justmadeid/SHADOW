# Security Engineering Baseline

## 1. Security goals

The platform must protect:
- restricted identifiers;
- Case confidentiality;
- cross-case isolation;
- evidence integrity;
- audit integrity;
- source credentials;
- connector network access;
- analyst conclusions and review history.

## 2. Mandatory controls

### Identity & access
- OIDC/service identity authentication.
- Server-side authorization for every resource access.
- Explicit Workspace and Case scope.
- Separate permission for resource existence vs detailed context.
- Separate `USE` vs `VIEW` permissions for restricted identifiers.
- Re-check permission when opening Notification/deep link.

### Restricted data
- Encrypt sensitive stored values where required.
- Use keyed HMAC/fingerprint for exact comparison of guessable identifiers.
- Never store plain NIK in logs, metrics, queue messages or traces.
- Masking performed by backend policy-aware presentation/query layer.
- Raw source retention policy enforced at ingestion.

### API
- Strict request schema.
- Request body/parameter limits.
- Mass-assignment protection: explicit writable fields.
- Cursor and filter validation.
- Idempotency on critical POST operations.
- Optimistic concurrency on mutable canonical resources.
- Rate limiting by actor/capability/source where appropriate.

### Worker/queue
- Service identity, not user browser token.
- Minimal `runId` queue payload.
- ExecutionPlan contains authorized fields and connector only.
- Restricted worker pool has separate network/secrets.
- Bounded retry/backoff.
- Lease/heartbeat to detect lost workers.
- Queue and internal API reject forged Run/Attempt relationships.

### Connector
- Explicit allowlisted target/endpoints.
- Protect against SSRF and unrestricted redirects.
- DNS/IP/egress policy where needed.
- Timeouts and maximum response/body sizes.
- Source-specific rate limit.
- Normalize errors; do not leak source secret/raw response to user.

### Web/UI
- Strict CSP appropriate to Next.js deployment.
- Treat Evidence/source text/HTML as untrusted.
- Sanitize or render as text by default.
- No token in URL/query string.
- Avoid localStorage for sensitive credentials.
- Authorization-hidden UI is convenience only; server remains enforcement point.

### Object storage
- Private by default.
- Short-lived signed access only after authorization.
- Content type validation.
- Filename/path is metadata, never trusted filesystem path.
- Malware/file scanning policy for uploaded documents when file upload enters scope.

## 3. Primary threat scenarios

1. IDOR: user changes `caseId`/`entityId` to read another Case.
2. Cross-case inference: search/profile reveals another sensitive Case.
3. Restricted identifier leakage via API/log/trace/error.
4. Connector SSRF or generic-proxy abuse.
5. Worker forged result or replay duplicates canonical effects.
6. External source content causes XSS.
7. Search projection leaks stale/unauthorized data.
8. Entity merge incorrectly collapses unrelated people.
9. Analysis output automatically becomes canonical knowledge/finding.
10. Object-store URL shared beyond authorization period.
11. Queue backlog causes unbounded resource exhaustion.
12. Supply-chain compromise in connector/analysis dependency.
13. Prompt-injection/data-exfiltration risk if LLM analysis is introduced later.

## 4. Security test minimum

Every sensitive feature must include:
- unauthorized user;
- wrong workspace;
- wrong case;
- permitted existence but denied detail;
- masked vs full field;
- revoked permission;
- stale notification/deep link;
- duplicate/replay request;
- malicious/untrusted text rendering;
- oversized payload;
- unexpected connector error.

## 5. Severity policy

A release is blocked by:
- Critical security defect;
- High defect involving broken authorization, sensitive-data disclosure, evidence integrity, audit bypass or arbitrary connector egress;
- unresolved architecture violation that creates an equivalent risk.

Other risks require documented owner and remediation date.
