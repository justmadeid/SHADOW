# Hypothesis & Finding Architecture v1

## 1. Why This Domain Exists

Evidence, Dataset, dan Analysis belum cukup untuk menjadikan platform sebagai Investigation Intelligence Platform.

Platform membutuhkan reasoning layer yang dapat menjelaskan:

```text
Apa yang sedang diuji investigator?
Apa yang mendukung atau membantahnya?
Apa conclusion akhir yang diterima Case?
```

Core reasoning chain:

```text
Evidence
→ Analysis
→ Candidate / Signal / Alert
→ Hypothesis
→ Evidence Evaluation
→ Finding
→ Review
→ Approved Case Intelligence
```

## 2. Semantic Separation

| Concept | Meaning |
|---|---|
| Evidence | Apa yang source menunjukkan/observasi |
| AnalysisResult | Apa yang algorithm/model menghasilkan |
| Claim | Proposition atomik yang dicatat dalam Knowledge |
| Hypothesis | Proposition investigatif yang sedang diuji |
| Alert | Kondisi yang membutuhkan perhatian |
| Finding | Human investigative conclusion |

Invariants:
- AnalysisResult bukan Finding.
- Alert bukan Finding.
- Hypothesis bukan Knowledge fact.
- Finding bukan automatic Workspace Knowledge.

---

## 3. Intelligence Module Ownership

`modules/intelligence` owns:

```text
Hypothesis
HypothesisAssessment
HypothesisResourceLink
HypothesisRevision

Finding
FindingResourceLink
FindingReview
FindingRevision

AnalystDecision
AnalystNote
IntelligenceHighlight
Case Intelligence Feed
Case Timeline
```

Hypothesis dan Finding tidak perlu menjadi service/module terpisah pada MVP.

---

# Part A — Hypothesis

## 4. Definition

> Hypothesis adalah proposition yang dibuat investigator untuk diuji menggunakan Evidence, Knowledge, dan Analysis.

Examples:
- Person A dan Person B memiliki hubungan operasional.
- Account X dioperasikan oleh Person A.
- Lonjakan mention negatif terhadap Organization X menunjukkan coordinated activity.

## 5. Hypothesis Model

```text
Hypothesis
├── id
├── workspaceId
├── caseId
├── investigationId?
├── title
├── statement
├── lifecycleStatus
├── assessment
├── confidence
├── subjectRefs[]
├── createdBy
├── createdAt
├── updatedAt
└── revision
```

### Lifecycle Status

```text
DRAFT
ACTIVE
CLOSED
ARCHIVED
```

### Assessment

Lifecycle dan assessment tidak boleh digabung.

```text
UNASSESSED
SUPPORTED
CONTRADICTED
INCONCLUSIVE
```

Avoid `PROVEN` sebagai status general.

### Confidence

MVP:

```text
UNASSESSED
LOW
MEDIUM
HIGH
```

Confidence wajib mempunyai rationale saat assessment dilakukan. Hindari confidence numeric tanpa explanation.

## 6. Hypothesis Resource Links

```text
HypothesisResourceLink
├── hypothesisId
├── resourceRef
├── role
├── strength?
├── analystNote?
├── resourceRevision?
├── createdBy
└── createdAt
```

Roles:
- `SUPPORTS`
- `CONTRADICTS`
- `CONTEXT`
- `QUALIFIES`

`QUALIFIES` digunakan untuk evidence yang membatasi/menjelaskan hypothesis tetapi tidak sepenuhnya membantah.

Possible linked resources:
- Evidence;
- AnalysisResult;
- Claim;
- Relationship;
- RelationshipCandidate;
- DatasetSnapshot;
- Alert;
- Entity.

## 7. Hypothesis Revision

Mengubah statement secara substantif tidak boleh diam-diam menghapus history.

Minimal:
- optimistic `revision`;
- AuditEvent;
- assessment history.

Recommended:
- `HypothesisRevision` bila statement/rationale berubah signifikan.

## 8. Hypothesis Does Not Auto-Create Knowledge

Example:

```text
Hypothesis:
Account X is controlled by Person A
Assessment: SUPPORTED / HIGH
```

Tidak otomatis menghasilkan:

```text
ACCOUNT-X ATTRIBUTED_TO PERSON-A
```

Investigator tetap membuat/confirm Case Relationship dan optional KnowledgePromotion.

## 9. UI Ownership

### SHADOW
- list hypotheses;
- status/assessment summary;
- link ke Case/Investigation;
- launch/create Finding.

### ECHO
Primary visual reasoning experience:
- hypothesis graph;
- support/contradiction map;
- related entities/relationships;
- evidence inspection.

### SPECTRA
Analysis detail dapat menawarkan:
- Create Hypothesis;
- Explore in ECHO;
- Create Draft Finding.

---

# Part B — Finding

## 10. Definition

> Finding adalah human investigative conclusion berdasarkan Evidence, Analysis, Knowledge, dan reasoning yang dapat ditelusuri.

Finding harus spesifik, defensible, dan mempunyai provenance.

Bad:

```text
A suspicious.
```

Better:

```text
Between 12–18 August 2026, Account A amplified content from Account B
142 times, with peak activity concentrated within repeated two-hour windows.
```

## 11. Finding Model

```text
Finding
├── id
├── workspaceId
├── caseId
├── investigationId?
├── type
├── title
├── statement
├── rationale
├── status
├── confidence
├── confidenceRationale
├── subjectRefs[]
├── timeRange?
├── createdBy
├── createdAt
├── reviewedBy?
├── approvedAt?
├── supersededBy?
└── revision
```

### Finding Types

Initial controlled vocabulary:
- `IDENTITY`
- `RELATIONSHIP`
- `ACTIVITY`
- `NETWORK`
- `TIMELINE`
- `NARRATIVE`
- `COORDINATION`
- `SOURCE_ASSESSMENT`
- `OTHER`

Taxonomy dapat berkembang tetapi tidak boleh menjadi free-text semata.

## 12. Finding Lifecycle

```text
DRAFT
IN_REVIEW
APPROVED
REJECTED
SUPERSEDED
RETRACTED
```

### DRAFT
Mutable according to author permissions.

### IN_REVIEW
Content stabil untuk review; mutation policy lebih ketat.

### APPROVED
Accepted Case intelligence. Tidak boleh diedit diam-diam.

### SUPERSEDED
Finding lama digantikan oleh Finding baru.

### RETRACTED
Finding ditarik tanpa replacement definitive.

## 13. Finding Confidence

```text
UNASSESSED
LOW
MEDIUM
HIGH
```

Finding harus menyimpan `confidenceRationale`.

Example:

```text
HIGH
Supported by two independent sources and exact temporal correlation;
no material contradictory evidence remained unresolved at approval time.
```

## 14. Finding Resource Links

```text
FindingResourceLink
├── findingId
├── resourceRef
├── resourceRevision?
├── role
├── analystNote?
├── createdBy
└── createdAt
```

Roles:
- `SUPPORTS`
- `CONTRADICTS`
- `CONTEXT`
- `QUALIFIES`

Finding harus dapat menyimpan contradictory resources untuk menghindari confirmation bias.

## 15. Version-Pinned Support

Approved Finding harus mereferensikan revision/version resource yang digunakan saat approval jika resource tersebut mutable.

Example:

```text
Finding F-10
uses Relationship R-4 revision 7
```

Bukan sekadar “current Relationship R-4”.

AnalysisResult idealnya immutable, sehingga reference langsung sudah memiliki reproducible lineage melalui DatasetSnapshot + model/version/configuration.

## 16. Finding Review

```text
FindingReview
├── id
├── findingId
├── reviewerId
├── decision
├── comment
└── createdAt
```

Decisions:
- `APPROVE`
- `REQUEST_CHANGES`
- `REJECT`

Governance future policy dapat menentukan:
- author ≠ reviewer;
- two-person approval untuk classification tertentu;
- mandatory review untuk HIGH/RESTRICTED findings.

## 17. Supersede & Retract

Approved Finding tidak diedit diam-diam.

### Supersede

```text
FINDING-10 → SUPERSEDED
supersededBy = FINDING-31
```

Digunakan bila new conclusion menggantikan old conclusion.

### Retract

```text
FINDING-10 → RETRACTED
reason = primary source integrity compromised
```

History tetap tersedia.

## 18. Hypothesis → Finding

Satu Hypothesis dapat menghasilkan 0..N Findings.

```text
Hypothesis:
A coordinates Network X

Finding 1:
A communicates repeatedly with B and C

Finding 2:
B and C repeatedly amplify identical URLs

Finding 3:
Posting synchronization is statistically unusual
```

Finding dapat link kembali ke originating Hypothesis sebagai `CONTEXT` atau explicit hypothesis reference.

## 19. Alert / Analysis → Finding

System boleh menawarkan **Create Draft Finding**, tetapi tidak auto-approve.

Example Coordination Analysis:

```text
HIGH coordination likelihood
```

Safe draft wording:

```text
Analysis identified signals consistent with coordinated activity
among Accounts A, B, and C.
```

Human investigator harus review statement, rationale, evidence, contradiction, dan confidence.

---

# Part C — API Skeleton

## 20. Hypothesis API

```text
POST /api/v1/cases/{caseId}/hypotheses
GET  /api/v1/cases/{caseId}/hypotheses
GET  /api/v1/hypotheses/{hypothesisId}
PATCH /api/v1/hypotheses/{hypothesisId}

POST /api/v1/hypotheses/{id}/actions/activate
POST /api/v1/hypotheses/{id}/actions/assess
POST /api/v1/hypotheses/{id}/actions/close
POST /api/v1/hypotheses/{id}/actions/create-finding

POST /api/v1/hypotheses/{id}/resource-links
DELETE /api/v1/hypotheses/{id}/resource-links/{linkId}
```

Create:

```json
{
  "investigationId": "...",
  "title": "Possible operational relationship",
  "statement": "Person A and Person B maintain an operational relationship.",
  "subjectRefs": [
    { "type": "ENTITY", "id": "PERSON-A", "workspaceId": "..." },
    { "type": "ENTITY", "id": "PERSON-B", "workspaceId": "..." }
  ]
}
```

Assess:

```json
{
  "assessment": "SUPPORTED",
  "confidence": "HIGH",
  "rationale": "Supported by two independent sources and recurring communication activity."
}
```

## 21. Finding API

```text
POST /api/v1/cases/{caseId}/findings
GET  /api/v1/cases/{caseId}/findings
GET  /api/v1/findings/{findingId}
PATCH /api/v1/findings/{findingId}

POST /api/v1/findings/{findingId}/resource-links
DELETE /api/v1/findings/{findingId}/resource-links/{linkId}

POST /api/v1/findings/{findingId}/actions/submit-review
POST /api/v1/findings/{findingId}/reviews
POST /api/v1/findings/{findingId}/actions/retract
POST /api/v1/findings/{findingId}/actions/supersede
```

Create:

```json
{
  "investigationId": "...",
  "type": "RELATIONSHIP",
  "title": "Meeting between Target A and B",
  "statement": "Evidence supports that Target A met Target B at Event X on 18 August 2026.",
  "rationale": "The meeting is independently reported by two sources and supported by timestamped media evidence.",
  "confidence": "HIGH",
  "confidenceRationale": "Independent-source corroboration and consistent timestamps.",
  "subjectRefs": []
}
```

Review:

```json
{
  "decision": "APPROVE",
  "comment": "Evidence and rationale sufficiently support the conclusion."
}
```

## 22. Realtime / Notification / Audit Events

Possible events:

```text
HYPOTHESIS_CREATED
HYPOTHESIS_ASSESSED
HYPOTHESIS_CLOSED

FINDING_CREATED
FINDING_SUBMITTED_FOR_REVIEW
FINDING_CHANGES_REQUESTED
FINDING_APPROVED
FINDING_REJECTED
FINDING_SUPERSEDED
FINDING_RETRACTED
```

Not every event becomes Notification.

Audit-sensitive actions:
- Finding approval/rejection;
- retract/supersede;
- hypothesis assessment changes;
- classified Finding access/export.

## 23. Case Intelligence Feed

Approved/retracted/superseded findings dapat menghasilkan `IntelligenceHighlight`.

Example:

```text
17:12 FINDING APPROVED
Possible coordinated amplification identified across 12 accounts.
```

## 24. Report Readiness

Architecture ini sengaja mempersiapkan future Report domain.

Report seharusnya terutama mengambil:
- Approved Findings;
- Case Timeline;
- referenced Evidence;
- approved/relevant Knowledge;
- analytical caveats;
- methodology.

Report tidak seharusnya menghasilkan conclusion langsung dari raw AnalysisResult tanpa Finding/review layer.

## 25. Invariants

### Hypothesis
1. Hypothesis adalah proposition untuk diuji, bukan fact.
2. Lifecycle dan assessment berbeda.
3. Supporting/contradicting/qualifying resources dapat coexist.
4. Hypothesis case-scoped.
5. Assessment harus mempunyai rationale.
6. Hypothesis tidak otomatis membuat Knowledge.
7. Analysis dapat menyarankan, bukan mengonfirmasi.
8. Revision/history dipertahankan.

### Finding
1. Finding adalah human conclusion.
2. Finding case-scoped.
3. Finding dapat link Evidence, Analysis, Claims, Relationships, Hypotheses.
4. Contradictory evidence dapat disimpan.
5. Confidence harus explainable.
6. Approved Finding immutable-ish.
7. Correction memakai revision/supersede/retract.
8. Finding tidak auto-promote ke Workspace Knowledge.
9. Alert bukan Finding.
10. AnalysisResult bukan Finding.
11. Approved Finding harus reproducible/auditable.
12. Review policy dikontrol Governance.
