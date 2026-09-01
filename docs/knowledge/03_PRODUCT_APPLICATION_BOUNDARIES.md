# Product & Application Boundaries

## 1. Prinsip

SHADOW, ECHO, dan SPECTRA adalah **experience/application boundaries**. Backend tidak boleh membuat `ShadowPerson`, `EchoPerson`, atau `SpectraPerson`. Semua memakai canonical shared domains.

## 2. Ownership Experience

| Capability | SHADOW | ECHO | SPECTRA |
|---|---:|---:|---:|
| Case lifecycle | Own | Context | Context |
| Investigation | Own | Context | Context |
| Subject / Target | Own | View | View |
| Target Profile | Own UI | Entity detail | Social context |
| Profile Inbox | Own UI | Contribute candidate | Contribute candidate |
| Discovery / lookup | Own | Trigger contextually | Trigger contextually |
| Entity Registry | Consume | Primary curation UI | Consume |
| Relationship review | Summary | Own | Candidate producer |
| Case Knowledge | Summary | Own curation | Consume |
| Workspace Knowledge | Consume | Own curation | Consume |
| Evidence | Overview | Inspect/overlay | Detailed activity/media |
| Monitoring | Summary | Context | Own |
| Social activity | Summary | Aggregated overlay | Own |
| Sentiment/engagement | Summary | Overlay metadata | Own |
| Alerts | Summary | Context | Own |
| Hypothesis | Case context | Own mapping | Analysis support |
| Findings | Own | Support | Support |

## 3. SHADOW Boundary

SHADOW owns user journeys:
- create/manage Case;
- create Investigation;
- add Subject;
- search existing Target Profiles;
- create SubjectSeed;
- trigger lookup/discovery;
- review Candidates;
- resolve target identity;
- view Evidence summary;
- create/manage Findings;
- Case Intelligence Feed;
- ECHO/SPECTRA summaries.

SHADOW does not:
- edit canonical graph directly;
- perform detailed social analytics;
- own monitoring engine;
- duplicate Entity Registry.

## 4. ECHO Boundary

ECHO owns:
- Entity graph;
- Case/Workspace Knowledge overlay;
- relationship review;
- claim comparison;
- duplicate/merge/split workflows;
- hypothesis mapping;
- evidence/activity correlation;
- analysis/candidate overlay.

ECHO dapat menampilkan social activity dari SPECTRA, tetapi default tidak membuat setiap post menjadi node.

Example:
```text
ACCOUNT-A -- 142 mentions --> ACCOUNT-B
```

Inspector dapat menampilkan top activity dan summary. Detail tetap `Open in SPECTRA`.

## 5. SPECTRA Boundary

SPECTRA owns:
- monitoring;
- social/news/media collection experience;
- activity timeline;
- sentiment;
- engagement;
- interaction/network;
- narrative;
- coordination analysis;
- alert management.

SPECTRA dapat menghasilkan:
- Evidence;
- AnalysisResult;
- EntityCandidate;
- RelationshipCandidate;
- IntelligenceHighlight;
- Alert.

SPECTRA tidak otomatis menghasilkan:
- canonical Entity;
- confirmed identity attribution;
- canonical Knowledge relationship;
- Finding.

## 6. ECHO Visual Layers

### Layer 1 — Knowledge
Confirmed/canonical relationships.

### Layer 2 — Observed Activity
Activity dari Evidence/SPECTRA, biasanya aggregated.

### Layer 3 — Analysis / Candidate Correlation
Tentative relationship/cluster dengan confidence/signals.

Visual distinction harus jelas agar user tidak menganggap semua edge sama kuat.

## 7. Cross-App Handoff

Semua handoff membawa:
- workspaceId;
- caseId;
- investigationId bila relevan;
- ResourceRef;
- optional target view/context;
- supporting EvidenceRef/AnalysisRef bila diperlukan.

Tidak melakukan JSON copy domain object.

## 8. Hybrid Frontend Phase

```text
apps/platform-web
├── shell
└── products
    ├── shadow
    ├── echo
    └── spectra
```

Aturan extraction-ready:
- product tidak import internals product lain;
- cross-product melalui API/contracts/resource refs/deep links;
- global state hanya auth/workspace/case/permissions/notification;
- state graph/filter/workflow tetap product-local.

Future split ke `shadow-web`, `echo-web`, `spectra-web` tidak boleh memerlukan rewrite domain flow.
