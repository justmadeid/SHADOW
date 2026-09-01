# Reference End-to-End Flows

Dokumen ini dapat digunakan developer, QA, dan product untuk menguji apakah sebuah implementasi mengikuti architecture yang sama.

## Flow 1 — Create Case dan Target Baru

```text
SHADOW
→ Create Case
→ Add Target
→ Search Existing Profiles
→ not found
→ Create InvestigationSubject
→ SubjectSeed
→ Person Lookup Node
→ Execution
→ Resident Connector
→ Hono Resident API
→ SourceRecord / Observation
→ PersonCandidate
→ Resolution Review
→ CREATE_NEW
→ Entity Registry creates PERSON-A
→ Subject RESOLVED
→ reusable Target Profile
```

## Flow 2 — Reuse Existing Target

```text
New Case
→ Add Target
→ Search Workspace Entity Registry
→ Existing PERSON-A
→ Compare
→ Use Existing
→ Subject/Case references PERSON-A
```

Tidak ada duplicate Person.

## Flow 3 — Social Account Discovery

```text
PERSON-A
→ Social Account Finder
→ source-specific child Runs
→ SocialProfileObservations
→ CandidateDataset<SocialAccount>
→ human review
→ ACCOUNT-X
→ Case relationship ACCOUNT-X ATTRIBUTED_TO PERSON-A
→ optional Workspace promotion
```

## Flow 4 — Collect Social Activity

```text
ACCOUNT-X
→ Collect Social Activity
→ pagination/checkpoint
→ SourceRecords
→ ActivityObservations
→ Evidence
→ DatasetSnapshot
```

Completeness wajib diketahui.

## Flow 5 — Sentiment Monitoring

```text
MonitoringTarget ACCOUNT-X
→ schedule due
→ shared Workflow/Execution
→ Evidence
→ DatasetSnapshot
→ Sentiment Analysis
→ MonitoringRule
→ Alert
→ SPECTRA detail
→ SHADOW Highlight/Summary
```

## Flow 6 — SPECTRA Menemukan B dari News

```text
News Evidence
→ Entity Extraction
→ Candidate-B
→ RelationshipCandidate A MET_WITH B
```

ECHO:
```text
A - - ? MET_WITH - - Candidate-B
```

Action `Investigate B in SHADOW`:
```text
Subject B
→ seed from news
→ search existing profile
→ lookup if needed
→ Resolution
→ PERSON-B
```

ECHO review:
```text
A - - ? MET_WITH - - PERSON-B
→ Confirm as Case Knowledge / Reject / Need More Evidence
```

## Flow 7 — SPECTRA Activity tampil di ECHO

```text
Evidence + Analysis
→ ActivityCorrelationSummary
→ ECHO overlay
```

Example:
```text
ACCOUNT-A -- 142 mentions --> ACCOUNT-B
```

Detail tetap dibuka di SPECTRA.

## Flow 8 — Knowledge Promotion

```text
Case Relationship
→ evidence + human confirmation
→ Promotion Review
→ Workspace Relationship
```

Workspace artifact memiliki lineage ke source Case Knowledge.

## Flow 9 — Knowledge Revocation

```text
Workspace Relationship
→ new conflicting evidence
→ ECHO review
→ REVOKED/Revision
→ Audit
→ affected Cases
→ IntelligenceHighlight
→ Notification
```

Historical Finding tidak diubah otomatis.

## Flow 10 — Entity Merge

```text
PERSON-001 + PERSON-882
→ duplicate review
→ merge decision
→ PERSON-001 survivor
→ PERSON-882 MERGED
→ old IDs resolve canonical
→ history preserved
```

## Flow 11 — Infrastructure Retry

```text
RUN-100
→ ATTEMPT-1
→ checkpoint
→ worker crash
→ ATTEMPT-1 LOST
→ ATTEMPT-2
→ resume
→ complete
```

Same Run, new Attempt.

## Flow 12 — Business Retry

```text
RUN-100 FAILED
→ user presses Retry
→ RUN-101 retryOf RUN-100
```

## Flow 13 — Restricted Resident Lookup

```text
User Request
→ Authentication
→ Governance
→ reason-for-access
→ Run + Outbox
→ restricted worker
→ Hono
→ Evidence/Observation
→ Candidate
→ Audit
```

Plain NIK tidak masuk log/broker payload.

## Flow 14 — Case Intelligence Feed

Producers:
- SHADOW runs;
- ECHO knowledge changes;
- SPECTRA alerts;
- future services.

Semua berkontribusi melalui `IntelligenceHighlight` yang diaggregate oleh SHADOW Case view.
