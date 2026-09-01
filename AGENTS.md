# AGENTS.md — Investigation Intelligence Platform

## Mission

Build an Investigation Intelligence Platform where collection, identity resolution,
knowledge curation, monitoring, analysis, and findings remain explainable, secure,
auditable, and performant.

## Non-negotiable domain rules

1. Canvas is not the database.
2. Candidate is not Entity.
3. Subject is not Entity.
4. Evidence is not automatically truth.
5. AnalysisResult is not canonical Knowledge.
6. Alert is not Finding.
7. Case Knowledge does not automatically become Workspace Knowledge.
8. Machine output never automatically confirms high-risk identity/relationship/finding.
9. Entity is Workspace-reusable; Evidence/Hypothesis/Finding remain Case-scoped.
10. Preserve provenance, conflicts, revisions, and human decisions.

## Architecture rules

- SHADOW/ECHO/SPECTRA are product experience boundaries, not backend domain silos.
- No cross-product internal imports.
- No cross-module repository/table imports.
- Workers do not directly write business tables.
- Investigation Elasticsearch is a projection, not canonical truth.
- `leaked-service` is the same technical service previously called the Hono Person Lookup / Resident API.
- Person lookup path: Platform -> Person Lookup Connector -> leaked-service (Hono) -> Elasticsearch.
- Never query the Elasticsearch store behind `leaked-service` directly.
- Never create duplicate Resident-Hono and leaked-service connectors.
- Outbox is dispatch truth; BullMQ is transport.
- Run != ExecutionAttempt.
- Public API `/api/v1`; internal worker API `/internal/v1`.

## Mandatory reading before coding

1. `docs/knowledge/00_README.md`
2. `docs/knowledge/12_ARCHITECTURE_DECISIONS.md`
3. `docs/knowledge/19_IMPLEMENTATION_ARCHITECTURE_GATES.md`
4. relevant domain:
   - `docs/knowledge/05_ENTITY_KNOWLEDGE_MODEL.md`
   - `docs/knowledge/06_EVIDENCE_ANALYSIS_MONITORING.md`
   - `docs/knowledge/07_WORKFLOW_EXECUTION_CONNECTORS.md`
   - `docs/knowledge/08_CROSS_CUTTING_ARCHITECTURE.md`
   - `docs/knowledge/17_HYPOTHESIS_FINDING_ARCHITECTURE.md`
5. `docs/knowledge/15_PLATFORM_API_CONTRACT_MAP.md`
6. `docs/knowledge/16_OPENAPI_DOMAIN_SKELETON.md`
7. relevant task in `docs/knowledge/20_DEVELOPMENT_BACKLOG_V1.md`
8. `docs/knowledge/22_ENGINEERING_STANDARDS.md`
9. `docs/knowledge/23_SECURITY_ENGINEERING_BASELINE.md`
10. `docs/knowledge/25_TEST_STRATEGY.md`
11. `docs/knowledge/32_DEFINITION_OF_DONE.md`
12. when applicable:
    - `docs/knowledge/33_THREAT_MODEL_BASELINE.md`
    - `docs/knowledge/34_DATA_CLASSIFICATION_HANDLING_MATRIX.md`
    - `docs/knowledge/39_CODE_REVIEW_CHECKLIST.md`

Full agent protocol:
`docs/knowledge/30_AI_AGENT_DEVELOPMENT_PLAYBOOK.md`

For SHADOW UI tasks additionally read `docs/product/shadow/` in filename order.

## Before implementation

State:
- task ID;
- owner;
- canonical source of truth;
- dependencies;
- API/event contracts;
- classification/security boundary;
- planned tests.

Inspect repository first. Do not invent current schema/file names.

## Security

- Never log NIK, phone, email, credentials, tokens, or raw restricted payload.
- Never weaken authorization for convenience.
- Never expose another Case through search/profile context.
- Never put secrets in queues/outbox.
- Treat source content as untrusted.
- New connector egress requires review.

## Required completion behavior

Before claiming completion:
- run tests;
- run architecture gates;
- update contracts;
- check security;
- check observability/audit;
- update docs/ADR if semantics changed.

If architecture and implementation conflict, surface the conflict rather than guessing.
