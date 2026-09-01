# Architecture Decisions & Invariants

Dokumen ini merangkum keputusan baseline yang dianggap **locked** sampai ada ADR/revisi resmi.

## A. Product & UX

1. SHADOW = Case Command Center & Investigation Workspace.
2. ECHO = Knowledge & Correlation Workspace.
3. SPECTRA = Social & Media Intelligence Workspace.
4. Ketiganya menggunakan shared Platform Core.
5. Fase awal menggunakan hybrid frontend dengan product boundaries yang extraction-ready.
6. Shared Case context harus tetap terbawa saat pindah workspace.
7. Specialized app boleh menampilkan output app lain, tetapi ownership/editing tetap pada domain/experience yang sesuai.

## B. Identity & Knowledge

1. Entity Registry workspace-scoped.
2. Case mereferensikan Entity, tidak menduplikasi.
3. Candidate ≠ Entity.
4. Subject ≠ Entity.
5. Target Profile adalah read model, bukan Person database kedua.
6. Case Knowledge ≠ Workspace Knowledge.
7. Confirm dalam Case tidak otomatis Promote ke Workspace.
8. Conflicting Claims boleh coexist.
9. Merge Entity harus auditable dan reversible.
10. Historical Findings tidak otomatis berubah ketika Workspace Knowledge direvisi.
11. Identity confirmation tidak otomatis mengonfirmasi semua source attributes.

## C. Evidence & Intelligence

1. SourceRecord ≠ Observation ≠ Evidence.
2. Evidence bukan otomatis truth.
3. Evidence Case-scoped walaupun mereferensikan Workspace Entity.
4. Analysis tidak memodifikasi Evidence.
5. AnalysisResult bukan canonical Knowledge.
6. DatasetSnapshot immutable.
7. DatasetView dynamic.
8. DatasetCompleteness wajib explicit.
9. MonitoringTarget mereferensikan Entity.
10. Alert ≠ Finding.
11. Coordination result adalah likelihood dengan explainable signals, bukan automatic “buzzer” label.

## D. Workflow & Execution

1. Workflow mengekspresikan capability intent, bukan connector implementation.
2. Capability ≠ Connector.
3. DataSource ≠ Connector.
4. Run ≠ ExecutionAttempt.
5. Run + ExecutionOutbox dibuat atomic.
6. Execution diasumsikan at-least-once; handler/ingestion harus idempotent.
7. Infrastructure retry = new Attempt, same Run.
8. Business/user retry = new Run.
9. Connector worker tidak direct write business DB.
10. Connector Runtime tidak membuat Entity/Finding/Knowledge canonical.
11. Secrets tidak boleh berada di job payload atau Run snapshot.
12. Bulk result dibatch atau disimpan by reference, bukan giant broker payload.

## E. Cross-Cutting

1. Authentication ≠ Authorization.
2. Permission to use ≠ permission to view.
3. Governance bersifat contextual.
4. Classification memengaruhi storage, masking, indexing, export, retention, dan worker routing.
5. Audit append-only.
6. Audit ≠ Observability.
7. Notification ≠ IntelligenceHighlight.
8. Realtime ≠ source of truth.
9. PII tidak masuk logs/metrics by default.
10. Cross-case visibility harus explicit.

## F. Backend Modularity

1. SHADOW/ECHO/SPECTRA bukan backend business modules.
2. Backend modules domain-based.
3. Module lain hanya akses public facade/contract.
4. Cross-module repository/table import dilarang.
5. Cross-module SQL dilarang kecuali read projection yang disengaja.
6. `platform/` shared primitives harus kecil.
7. Domain events untuk decoupled side effects.
8. Outbox/job transport untuk cross-process work.
9. Experience-specific read models boleh aggregate beberapa domain.
10. Backend tetap modular monolith sampai ada alasan split yang nyata.

## G. Anti-Patterns yang Harus Dihindari

Jangan:
- membuat `ShadowPerson`, `EchoPerson`, `SpectraPerson`;
- membuat Person God Object;
- auto-create Entity dari ML/entity extraction;
- auto-confirm relationship dari sentiment/coordination result;
- menyalin seluruh Resident Elasticsearch ke platform;
- query Resident Elasticsearch langsung dari Platform Core;
- menganggap Elasticsearch relevance `_score` = identity confidence;
- overwrite edited/deleted content tanpa history;
- menyimpan engagement/followers sebagai canonical static Entity fields;
- menaruh business logic dalam giant `CommonModule`;
- broadcast full sensitive object lewat SSE;
- menaruh API key dalam BullMQ payload;
- membuat setiap post menjadi ECHO node;
- membiarkan Case B membaca Evidence Case A hanya karena Entity sama;
- menganggap Alert sama dengan Finding;
- menganggap analysis output sama dengan truth.

## H. Invariants per Pipeline

### Subject
- RESOLVED Subject harus menunjuk canonical Entity.
- UNRESOLVED Subject tidak wajib memiliki Entity.
- Subject role Case-specific.

### Resolution
- Candidate tidak pernah canonical sebelum decision.
- Search relevance bukan identity confidence.
- Signals/conflicts/decision harus dipertahankan.

### Entity Registry
- Entity ID stable.
- Merged ID tetap resolvable.
- Registry berisi identity, bukan allegation.

### Knowledge
- Significant Claim/Relationship harus traceable ke evidence/decision.
- Case Knowledge tidak otomatis Workspace Knowledge.
- Revision preserve history.

### Evidence
- Provenance wajib.
- History tidak silent overwrite.

### Dataset
- Snapshot immutable.
- Dynamic View tidak masquerade sebagai snapshot.

### Analysis
- model/version/config/input traceable.
- Analysis tidak memodifikasi Evidence.

### Monitoring
- menggunakan shared Workflow/Execution.
- rule versioned.

### Governance
- authorization contextual.
- use/view permission dipisahkan.

### Audit
- append-only dan data-minimizing.

### Realtime
- minimal payload; canonical state tetap via API.

## I. Architecture Tests yang Disarankan

- frontend product import lint rules;
- backend module dependency lint rules;
- dependency graph CI;
- connector contract tests;
- idempotency/retry tests;
- provenance lineage tests;
- access-control integration tests;
- masking tests;
- critical audit durability tests;
- dataset reproducibility tests;
- merge/reverse-merge tests;
- cross-case confidentiality tests.
