# MVP Scope & Milestones

## North-star

MVP harus membuktikan **satu loop investigasi end-to-end yang defensible**, bukan jumlah halaman.

```text
Create Case
→ Add Person Subject
→ Person Lookup via Resident Hono API
→ Review Candidate
→ Link/Create Entity
→ Target Profile
→ Create/Review Knowledge
→ Collect Evidence
→ Dataset Snapshot
→ Basic Analysis
→ Discover Candidate B
→ Investigate/Resolve B
→ Confirm Case Relationship
→ Hypothesis
→ Finding
→ Review/Approve
```

## Milestones

### M0 — Engineering Ready
Repo, CI, tests, local dependencies, observability, config, boundary rules tersedia.

### M1 — Protected Case Shell
Auth, Workspace, Case, Investigation, Governance, Audit baseline, shared frontend shell.

### M2 — Reusable Identity Core
Subject/Seed/Candidate/Resolution/Entity bekerja tanpa duplicate Person model.

### M3 — Reliable Async Runtime
Run/Attempt/Outbox/BullMQ/worker/internal API/retry/checkpoint/cancel/SSE.

### M4 — Person Lookup End-to-End
SHADOW → Run → restricted worker → Hono → Evidence/Observation → Candidate → Resolution → Entity.

**Ini adalah vertical slice pertama yang harus benar-benar production-shaped.**

### M5 — Curated Knowledge Graph
Claims/Relationships/Promotion/Conflict + ECHO layered graph.

### M6 — Reproducible Analysis
Dataset Snapshot + AnalysisDefinition/Result + lineage + basic extraction/sentiment.

### M7 — Continuous Intelligence
Monitoring → collection → Evidence → Dataset → Analysis → Alert + SPECTRA UI.

### M8 — Recursive Investigation Loop
SPECTRA/ECHO discovery → Profile Inbox → Subject → Resolution → new Entity → relation review.

### M9 — Defensible Case Intelligence
Hypothesis + Finding + contradiction + review + approval/supersede/retract.

### M10 — Fast Investigation Search
Governance-aware Investigation Elasticsearch projections.

### M11 — Production Candidate
Security, performance, DR, retention, export, operational dashboards and release safety proven.

## MVP inclusion

Must have:
- one Workspace;
- Case + Investigation;
- Person Subject;
- existing Resident Hono Person Lookup;
- Candidate review;
- reusable Person Entity;
- restricted identifier masking/match-only;
- Run/Attempt/outbox/worker;
- Evidence provenance;
- Claim/Relationship;
- ECHO minimum graph;
- Dataset Snapshot;
- one basic analysis;
- at least one monitoring source when source contract is authorized;
- Profile Inbox recursive discovery;
- Hypothesis;
- Finding review/approval;
- governance-aware search;
- audit + observability.

## Explicitly not required for MVP

- Neo4j as canonical store;
- microservice split of domain modules;
- full WebSocket collaborative canvas;
- broad connector marketplace;
- universal ML platform;
- automatic identity confirmation;
- automatic canonical relationship promotion;
- automatic Finding approval;
- cross-case evidence sharing;
- shared collection optimization across Cases;
- complex multi-reviewer workflow unless governance requires it;
- full report-builder/editor;
- mobile app parity.

## Success criteria

MVP is successful when an investigator can execute the North-star flow and every important conclusion can be traced:

```text
Finding
→ supporting/contradicting resources
→ AnalysisResult
→ Dataset Snapshot
→ Evidence
→ Observation / SourceRecord
→ Run
→ Connector
→ Data Source
```

while authorization, confidentiality, audit and revision history remain intact.
