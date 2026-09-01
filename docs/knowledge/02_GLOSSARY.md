# Glossary

Dokumen ini adalah referensi istilah utama agar developer, analyst, QA, dan stakeholder menggunakan vocabulary yang sama.

## Scope & Investigation

### Workspace
Boundary organisasi/tenant utama. Scope reusable untuk Entity Registry dan Workspace Knowledge.

### Case
Container investigasi lintas aplikasi. Memiliki Investigation, Subjects, Evidence, Findings, Highlights, Alerts, Timeline, dan references ke resource ECHO/SPECTRA.

### Investigation
Branch/sub-unit investigasi di dalam Case dengan objective tertentu.

### InvestigationSubject
Sesuatu yang sedang menjadi fokus investigasi. Dapat `UNRESOLVED`, `RESOLVING`, atau `RESOLVED` ke Entity. **Subject bukan Entity.**

### SubjectSeed
Informasi awal untuk mencari/resolve Subject: nama, phone, lokasi, username, atau hasil extraction. Field idealnya memiliki provenance.

### SubjectRole
Role Subject dalam Case: `PRIMARY_TARGET`, `SECONDARY_TARGET`, `PERSON_OF_INTEREST`, `RELATED_PERSON`, `WITNESS`, `UNKNOWN`.

### Target Profile
Istilah UI SHADOW untuk reusable profile view yang dibangun dari Workspace Entity + Workspace Knowledge + provenance + current Case context. Bukan database Person kedua.

### Profile Inbox
SHADOW read model yang mengumpulkan unresolved subjects, candidates, entity discoveries, relationship discoveries, dan extraction dari ECHO/SPECTRA.

## Identity

### Entity
Canonical object reusable di Workspace. Contoh: Person, Organization, SocialAccount, EmailAddress, PhoneNumber, Location, Domain, Website, IP, Vehicle, Device, Event, Document.

### Entity Registry
Workspace-level canonical identity layer. Menjawab **“siapa/apa object ini?”**

### Identifier
Nilai pencarian/dedupe: NIK/National ID, phone, email, platform user ID, username, internal resident record ID.

### Alias
Nama/label alternatif Entity.

### Canonical Label
Label utama untuk display; bukan klaim bahwa semua source sepakat.

### Candidate
Hasil discovery/lookup/extraction yang belum menjadi canonical Entity. **Candidate ≠ Entity.**

### Resolution
Proses memutuskan Candidate menjadi `LINK_EXISTING`, `CREATE_NEW`, `UNCERTAIN`, atau `REJECT`.

### ResolutionSession
Context review candidate, possible matches, matching signals, conflict signals, dan decision.

### MatchingSignal
Signal seperti exact national ID, exact phone, DOB match, name similarity, stable platform ID.

### ConflictSignal
Signal bertentangan seperti DOB conflict atau identifier mismatch.

### EntityMerge
Menggabungkan dua canonical Entity menjadi satu survivor. Harus auditable dan reversible.

### CaseEntityReference
Reference dari Case ke Workspace Entity. Case tidak menduplikasi Entity.

## Knowledge

### Knowledge
Apa yang diketahui/diyakini tentang Entity berdasarkan Claim, Relationship, Evidence, dan human Decision.

### KnowledgeScope
`CASE` atau `WORKSPACE`.

### Case Knowledge
Knowledge khusus Case; boleh exploratory, unverified, supported, confirmed, atau conflicted.

### Workspace Knowledge
Knowledge reusable lintas Case; lebih konservatif dan curated.

### Claim
Proposition umum, misalnya `PERSON-A DATE_OF_BIRTH 1990-01-01`.

### Relationship
Relasi Entity-to-Entity, misalnya `PERSON-A WORKS_FOR ORG-B`.

### RelationshipCandidate
Relasi hasil source/analysis yang belum confirmed.

### KnowledgePromotion
Keputusan explicit untuk menghasilkan Workspace Knowledge dari Case Knowledge.

### KnowledgeRevision
Revisi/versioning tanpa menghapus history.

### Finding
Kesimpulan analyst yang didukung Evidence/Claim/Relationship/Analysis.

### Hypothesis
Hipotesis yang dapat memiliki evidence `SUPPORTS` dan `CONTRADICTS`.

## Evidence

### DataSourceDefinition
Definisi business/governance sebuah source: owner, classification, trust, retention, raw persistence policy.

### ConnectorDefinition
Definisi teknis cara platform berinteraksi dengan Data Source.

### SourceRecord
Immutable semantic record tentang apa yang dikembalikan source pada suatu Run.

### Observation
Normalized statement tentang apa yang source laporkan pada suatu waktu.

### Evidence
Normalized investigation artifact. Evidence berarti source menunjukkan sesuatu; tidak otomatis berarti isi tersebut benar.

### EvidenceRelation
Relasi source-level seperti `AUTHORED_BY`, `MENTIONS`, `REPLY_TO`, `QUOTE_OF`, `REPOST_OF`.

### EngagementSnapshot
Snapshot likes/comments/reposts pada waktu tertentu.

### Provenance
Lineage source → connector → run → record → observation/evidence.

## Dataset & Analysis

### Dataset
Abstraction atas kumpulan Evidence.

### DatasetSnapshot
Immutable membership untuk reproducible analysis.

### DatasetView
Dynamic query/view; membership dapat berubah.

### DatasetCompleteness
`COMPLETE`, `PARTIAL`, `UNKNOWN` dengan reason seperti ITEM_LIMIT, TIME_LIMIT, API_LIMIT, SOURCE_ERROR, PERMISSION_LIMIT, USER_CANCELLED.

### AttributionContext
Context kepastian attribution pada input dataset.

### AnalysisDefinition
Definisi analysis/model/algorithm.

### AnalysisResult
Output analysis dengan lineage ke dataset, model/version, config, dan Run.

### AnalysisArtifact
Artifact besar seperti embedding, cluster, graph, report, atau media result yang disimpan by reference.

### CoordinationLikelihood
Derived analysis kemungkinan coordinated activity. Bukan label absolut “buzzer”.

## Monitoring

### MonitoringTarget
Target yang dipantau. Bila berupa Entity, gunakan `entityId`.

### Watchlist
Kumpulan MonitoringTarget.

### MonitoringRule
Rule yang menentukan kapan signal menjadi Alert.

### Baseline
Kondisi historis/normal sebagai pembanding.

### Alert
Signal yang membutuhkan perhatian. **Alert ≠ Finding.**

### Narrative
Derived analytical construct tentang tema/isu yang berkembang; bukan canonical fact.

## Workflow & Execution

### Capability
Kemampuan abstrak seperti `PERSON_LOOKUP`, `SOCIAL_ACCOUNT_SEARCH`, `SOCIAL_ACTIVITY_COLLECTION`, `NEWS_SEARCH`.

### NodeDefinition
Reusable capability template.

### NodeInstance
NodeDefinition yang ditempatkan pada Investigation/Canvas.

### InputBinding
Typed field mapping dari resource/output ke input capability.

### Run
Satu logical business execution.

### ExecutionAttempt
Satu physical worker attempt untuk Run. **Run ≠ ExecutionAttempt.**

### ExecutionPlan
Immutable execution contract untuk worker.

### RunCheckpoint
Opaque state untuk resume pagination/incremental execution.

### ExecutionOutbox
Transactional record agar Run yang dibuat pasti dapat didispatch.

## Cross-Cutting

### Governance
Authorization, data classification, connector/field access, retention, export, cross-case confidentiality.

### DataClassification
`PUBLIC`, `INTERNAL`, `SENSITIVE`, `RESTRICTED`.

### ReasonForAccess
Alasan akses yang diwajibkan untuk operation/source tertentu.

### AuditEvent
Append-only record siapa melakukan apa terhadap resource apa, kapan, dan outcome.

### Notification
Persistent user attention message.

### IntelligenceHighlight
Highlight penting untuk Case. Tidak sama dengan Notification.

### RealtimeEvent
Minimal server-to-client update. Realtime bukan source of truth.

### Observability
Logs + Metrics + Traces untuk kesehatan teknis sistem.

### RequestContext
Context request: userId, workspaceId, caseId?, investigationId?, requestId, traceId, reasonForAccess?.

### ResourceRef
Generic reference ke canonical resource tanpa copy object.

### DeepLinkTarget
Contract navigation lintas SHADOW/ECHO/SPECTRA dengan context tetap terjaga.
