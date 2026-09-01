# AI Agent Development Playbook

This document is designed for Codex and other coding agents.

## 1. Source-of-truth reading order

Before changing code, read:

1. `/AGENTS.md`
2. `00_README.md`
3. `12_ARCHITECTURE_DECISIONS.md`
4. `19_IMPLEMENTATION_ARCHITECTURE_GATES.md`
5. the relevant domain document:
   - identity/knowledge: `05_ENTITY_KNOWLEDGE_MODEL.md`
   - evidence/analysis: `06_EVIDENCE_ANALYSIS_MONITORING.md`
   - execution/connectors: `07_WORKFLOW_EXECUTION_CONNECTORS.md`
   - cross-cutting: `08_CROSS_CUTTING_ARCHITECTURE.md`
   - reasoning: `17_HYPOTHESIS_FINDING_ARCHITECTURE.md`
6. `15_PLATFORM_API_CONTRACT_MAP.md`
7. `16_OPENAPI_DOMAIN_SKELETON.md`
8. the task in `20_DEVELOPMENT_BACKLOG_V1.md`
9. relevant engineering/security/test guide.

If documents conflict:
- newest versioned architecture/ADR wins;
- do not guess;
- record the conflict and request/prepare an ADR before changing semantics.

## 2. Agent task protocol

For each task:

### A. Restate scope
Identify:
- task ID;
- owning module/product;
- canonical source of truth;
- API/event contracts;
- security classification;
- hard dependencies.

### B. Inspect existing code
Do not assume folder/file/schema names from architecture prose.
Search current repository.

### C. Write a short implementation plan
Include:
- files/modules touched;
- migrations;
- API changes;
- events;
- tests;
- security/performance implications.

### D. Implement smallest coherent slice
Do not opportunistically redesign unrelated modules.

### E. Test
Run the narrowest relevant tests, then required gates.

### F. Self-review
Check `39_CODE_REVIEW_CHECKLIST.md` and applicable architecture gates.

### G. Report
Summarize:
- behavior implemented;
- contracts changed;
- migrations;
- tests;
- unresolved risks;
- next dependency.

## 3. Forbidden shortcuts

Never:
- turn Candidate into Entity automatically;
- treat source relevance as identity confidence;
- write AnalysisResult into canonical Entity/Knowledge automatically;
- create approved Finding from model output;
- bypass Hono and query Resident Elasticsearch directly;
- give worker direct business DB write because it is “easier”;
- import another domain's repository/table;
- duplicate Entity model inside SHADOW/ECHO/SPECTRA;
- store raw NIK/phone/email in logs;
- send secrets or bulk evidence through queue payload;
- expose internal source endpoint/credential to browser;
- use `any` to bypass a contract problem;
- silently catch errors and return empty data;
- weaken authorization to make a test pass;
- delete historical evidence/knowledge/finding to represent correction.

## 4. Security behavior

Assume every external input is hostile:
- HTTP body;
- query;
- cursor;
- connector response;
- source content;
- file metadata;
- queue message.

Do not log sensitive values.
Do not add a new external network destination without connector/security review.

## 5. Performance behavior

Before adding a query:
- determine expected cardinality;
- ensure pagination;
- avoid N+1;
- add/index only for actual predicate/order;
- keep high-volume aggregation server-side;
- do not load whole Case graph if focused query suffices.

## 6. Database behavior

- migration + model + tests together;
- use module-owned repository;
- preserve forward/backward compatibility;
- no destructive migration without explicit plan;
- do not hold transaction during external calls.

## 7. API behavior

- update OpenAPI/schema with implementation;
- stable error code;
- idempotency for critical POST;
- revision concurrency where relevant;
- 202 for long-running execution;
- authorization is server-side.

## 8. Agent output quality

A task is incomplete if the agent only writes code but does not:
- test it;
- update contracts;
- consider security;
- consider observability;
- preserve provenance;
- update documentation when semantics changed.
