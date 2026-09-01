# System Concept

## 1. Positioning

Platform dibangun sebagai **Investigation Intelligence Platform**, bukan sekadar OSINT canvas atau social monitoring dashboard.

Tujuan utama:
- membuat Case dan Investigation;
- mendefinisikan target/subject;
- mencari dan memverifikasi profile/identity;
- mengumpulkan evidence dari source internal maupun authorized/public;
- membangun dan memetakan relasi antar Entity;
- melakukan analysis terhadap evidence;
- memonitor aktivitas sosial, media, berita, dan isu;
- menguji Hypothesis;
- menghasilkan Finding yang dapat ditelusuri ke Evidence;
- menjaga governance, confidentiality, provenance, dan audit.

## 2. Product Suite

### SHADOW — Subject Hunting, Analysis, Discovery & Open-source Watch
**Peran:** Case Command Center & Investigation Workspace.

Fokus:
- Case dan Investigation;
- Investigation Subject;
- Target Profiles;
- Profile Inbox;
- discovery/lookup;
- collection workflow;
- candidate review;
- evidence overview;
- findings;
- Case Intelligence Feed;
- summary dari ECHO/SPECTRA.

> **SHADOW discovers and investigates.**

### ECHO — Entity Correlation & Human Observation
**Peran:** Knowledge & Correlation Workspace.

Fokus:
- Entity graph;
- Workspace Knowledge + Case Knowledge overlay;
- relationship review;
- claim comparison;
- entity resolution support;
- merge/split entity;
- hypothesis mapping;
- evidence/activity overlay;
- SPECTRA correlation overlay.

> **ECHO correlates and curates knowledge.**

### SPECTRA — Social Profiling, Entity Correlation, Tracking & Reconnaissance Analysis
**Peran:** Social & Media Intelligence Workspace.

Fokus:
- social profile;
- monitoring;
- news/media collection;
- post/comment/reply/mention activity;
- engagement;
- sentiment;
- timeline;
- interaction/network;
- narrative;
- coordination likelihood;
- alerts.

> **SPECTRA observes and analyzes activity.**

## 3. SHADOW sebagai Case Command Center

```text
CASE-001
├── Subjects / Targets             ← SHADOW
├── Entity Correlation Summary     ← ECHO
├── Social / Media Summary         ← SPECTRA
├── Evidence Summary
├── Findings
├── Highlights
├── Alerts
├── Intelligence Feed
└── Timeline
```

Prinsip:
> Specialized application boleh memvisualisasikan output aplikasi lain, tetapi tidak menduplikasi atau mengambil ownership domain data aplikasi tersebut.

Contoh:
- SHADOW menampilkan ECHO summary, tetapi edit graph tetap di ECHO.
- SHADOW menampilkan SPECTRA summary, tetapi detailed social analysis tetap di SPECTRA.
- ECHO dapat menampilkan aktivitas sosial dari SPECTRA sebagai overlay.
- SPECTRA memakai Entity Registry tetapi tidak mengelola canonical identity.

## 4. Shared Case Context

Mental model user:
> Saya tetap berada di CASE-001; saya hanya mengganti alat yang digunakan.

Context lintas workspace:
- workspace;
- case;
- investigation bila relevan;
- entity/resource reference;
- deep-link target.

## 5. Cross-App Actions

### SHADOW
- Open in ECHO
- Monitor in SPECTRA

### ECHO
- Investigate in SHADOW
- Monitor in SPECTRA

### SPECTRA
- Investigate in SHADOW
- Explore in ECHO

Handoff membawa **resource reference + context + supporting evidence**, bukan copy data.

## 6. Case Intelligence Feed

Semua capability dapat berkontribusi melalui `IntelligenceHighlight`.

```text
18:42 SPECTRA  Negative mention volume increased
18:35 ECHO     New relationship confirmed
18:21 SHADOW   Person Lookup completed
17:58 SPECTRA  High-engagement content detected
```

Future services juga harus dapat publish Summary, Highlight, Alert, dan ResourceRef tanpa hard-code SHADOW/ECHO/SPECTRA di domain.

## 7. Case Timeline

Berbeda dari Audit Log. Timeline adalah kronologi intelligence yang bermakna bagi investigator.

```text
12 Aug  Target added
13 Aug  Resident identity confirmed
14 Aug  Social account attributed
15 Aug  Negative campaign started
16 Aug  Account cluster detected
17 Aug  Relationship confirmed
```

## 8. Core Intelligence Loop

```text
Known Entity
→ Monitor / Collect
→ Evidence
→ Analysis
→ Unknown Candidate
→ Resolve
→ New Entity
→ Knowledge
→ Correlate / Monitor again
```

Loop ini adalah mental model utama sistem.
