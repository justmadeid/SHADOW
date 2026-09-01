# Evidence → Dataset → Analysis → Monitoring

## 1. Pipeline

```text
Source
→ Connector
→ SourceRecord
→ Observation
→ Evidence
→ Dataset
→ Analysis
→ Monitoring / Candidate / Highlight / Alert
```

Monitoring juga dapat memicu collection baru sehingga membentuk loop.

## 2. SourceRecord

Merepresentasikan apa yang source kembalikan pada execution tertentu.

Minimal lineage:
- source;
- connector;
- run;
- externalRecordId;
- collectedAt;
- classification;
- payloadRef bila disimpan.

SourceRecord bersifat semantic immutable.

## 3. Observation

Normalized statement tentang apa yang source laporkan.

Contoh:
```text
Resident Data melaporkan:
name = Ahmad Wijaya
address = Semarang
observedAt = 2026-08-20
```

Observation bukan canonical truth.

## 4. Evidence

Normalized investigation artifact yang dapat digunakan oleh:
- Claim;
- Relationship;
- Analysis;
- Hypothesis;
- Finding.

Evidence tetap Case-scoped walaupun mereferensikan Workspace Entity.

## 5. Raw Payload Policy

Source policy menentukan apakah raw payload:
- disimpan;
- short-lived;
- redacted;
- atau tidak disimpan.

Resident restricted source dapat melarang raw persistence dan hanya mengizinkan selected normalized data + provenance.

## 6. History

Edited content tidak overwrite destructively.

Deleted/unavailable content menghasilkan tombstone observation.

Engagement tidak menjadi static field yang ditimpa, tetapi `EngagementSnapshot` berdasarkan waktu.

## 7. EvidenceRelation vs Knowledge Relationship

EvidenceRelation contoh:
- POST `MENTIONS` ACCOUNT-B;
- `REPLY_TO`;
- `QUOTE_OF`;
- `REPOST_OF`.

Knowledge Relationship contoh:
- PERSON-A `ASSOCIATED_WITH` PERSON-B.

Evidence relation tidak otomatis menjadi Knowledge.

## 8. Dataset Snapshot

Dataset adalah selection/membership atas Evidence, bukan copy Evidence.

`DatasetSnapshot` immutable untuk reproducibility:
```text
DATASET-100
itemCount: 2843
completeness: PARTIAL
dateRange: ...
```

Data baru menghasilkan snapshot baru.

## 9. Dataset View

Dynamic exploration query. Membership dapat berubah. Dataset View tidak boleh dianggap immutable analysis input tanpa dibuat snapshot.

## 10. Completeness

Status:
- COMPLETE
- PARTIAL
- UNKNOWN

Possible reason:
- ITEM_LIMIT
- TIME_LIMIT
- API_LIMIT
- PERMISSION_LIMIT
- SOURCE_ERROR
- USER_CANCELLED

Analysis harus mengetahui input completeness agar tidak overclaim.

## 11. Attribution Context

Dataset menyimpan context attribution.

Example:
```text
account identity = CONFIRMED
account → person attribution = UNCERTAIN
```

Analysis tidak boleh mengklaim bahwa seluruh activity pasti dilakukan Person jika attribution belum confirmed.

## 12. Analysis

Setiap AnalysisResult memiliki lineage:
- input DatasetSnapshot;
- algorithm/model;
- model version;
- configuration;
- Run;
- timestamp;
- artifact reference bila perlu.

Analysis tidak memodifikasi Evidence.

## 13. Output Analysis

- AnalysisResult
- AnalysisResultSet
- EntityCandidateDataset
- RelationshipCandidateDataset
- ClusterResult
- TrendResult
- AnomalyResult
- IntelligenceHighlight

## 14. Sentiment

Per-content:
```text
POST-1 → NEGATIVE 0.91
```

Aggregate:
```text
Negative 63%
Neutral 27%
Positive 10%
```

Model/version harus selalu diketahui.

## 15. Engagement

Raw Evidence menyimpan snapshots. Analysis dapat menghasilkan:
- engagement velocity;
- virality score;
- top content;
- growth rate.

## 16. Entity / Relationship Extraction

News:
```text
A bertemu dengan B di Jakarta
```

Analysis dapat menghasilkan:
```text
EntityCandidate B
RelationshipCandidate A MET_WITH B
```

Bukan canonical Entity/Relationship sampai melalui Resolution/Review.

## 17. Coordination Analysis

Signals dapat meliputi:
- similar text;
- synchronized timing;
- same hashtags/URLs;
- repeated mutual amplification;
- network centralization.

Output adalah **CoordinationLikelihood**, bukan automatic label “buzzer”.

## 18. MonitoringTarget

Target monitoring mereferensikan Entity jika tersedia:
```text
MonitoringTarget
caseId: CASE-001
entityId: ACCOUNT-021
status: ACTIVE
```

Monitoring tidak copy Account.

## 19. Monitoring Schedule

Monitoring menggunakan Workflow/Execution yang sama:
```text
Schedule Due
→ Collect Social Activity / News Search
→ Execution
→ Connector
→ Evidence
```

Tidak ada collection engine khusus SPECTRA.

## 20. Baseline & Rule

Example:
```text
baseline mention volume = 100/day
current = 350/day
rule = > 3x baseline
```

MonitoringRule harus versioned.

## 21. Alert

Alert adalah signal yang membutuhkan perhatian, bukan Finding.

Lifecycle:
- OPEN
- ACKNOWLEDGED
- INVESTIGATING
- RESOLVED
- DISMISSED

Repeated condition dapat digabung dalam AlertGroup.

## 22. ECHO Activity Overlay

Default aggregation:
```text
ACCOUNT-A -- 142 mentions --> ACCOUNT-B
ACCOUNT-A -- 78 replies --> ACCOUNT-B
```

Inspector dapat menampilkan top content, peak time, sentiment, engagement, dan link `Open in SPECTRA`.

## 23. Invariants

- Evidence preserves provenance.
- Evidence is not truth.
- Dataset Snapshot immutable.
- Dataset View dynamic.
- Analysis never mutates Evidence.
- Analysis is not canonical Knowledge.
- Candidate from Analysis requires Resolution/Review.
- Monitoring uses shared Workflow/Execution.
- Alert is not Finding.
