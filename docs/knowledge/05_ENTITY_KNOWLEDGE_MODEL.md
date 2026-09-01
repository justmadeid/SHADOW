# Workspace Entity Registry & Case Knowledge Model

## 1. Prinsip Utama

> Entity menjawab “siapa/apa object ini?”  
> Knowledge menjawab “apa yang diketahui atau diyakini tentang object tersebut?”

Jangan mencampur identity dengan investigation interpretation.

## 2. Scope Model

```text
Workspace
├── Entity Registry
│   ├── PERSON-A
│   ├── PERSON-B
│   └── ACCOUNT-X
├── Workspace Knowledge
├── Case A
│   ├── CaseEntityReference
│   ├── Case Claims
│   ├── Case Relationships
│   ├── Evidence
│   ├── Hypotheses
│   └── Findings
└── Case B
    └── ...
```

## 3. Entity Registry Harus Thin

```text
Entity
├── id
├── workspaceId
├── type
├── status
├── canonicalLabel
├── identifiers
└── aliases
```

Hindari God Object Person yang menyimpan employer, spouse, address, social accounts, dan seluruh history sebagai flat fields.

## 4. Identifier

Sensitive identifier dapat direpresentasikan dengan:
- encryptedValue bila perlu;
- comparisonFingerprint untuk deterministic matching;
- maskedValue untuk UI;
- classification;
- validity/status;
- provenance.

Untuk identifier guessable seperti NIK, deterministic comparison sebaiknya keyed fingerprint/HMAC, bukan plain SHA-256.

Prinsip:
> permission to use ≠ permission to view.

## 5. Case Reuses Entity

```text
CASE-A → CaseEntityReference → PERSON-001
CASE-B → CaseEntityReference → PERSON-001
```

Tidak membuat duplicate Person hanya karena muncul di Case lain.

## 6. InvestigationSubject dan Target Profile

`InvestigationSubject` adalah fokus Case. Bisa unresolved atau resolved ke Entity.

`TargetProfileView` adalah SHADOW read model:
```text
Workspace Entity
+ Workspace Knowledge
+ provenance/freshness
+ current Case context
```

Target Profile bukan source of truth baru.

## 7. Reuse Existing Profile

Flow Case baru:
```text
Add Target
→ Search Existing Target Profiles / Entity Registry
→ Use Existing / Compare / Create New
```

Jika baru:
```text
SubjectSeed
→ Person Lookup
→ Candidate
→ Resolution
→ Entity
→ reusable profile
```

## 8. Profile Freshness

Reuse tidak berarti semua informasi tetap current. UI dapat menampilkan freshness per source/context:
- last resident lookup;
- last social observation;
- last identity review;
- last knowledge update.

## 9. Candidate → Entity

Resolution outcomes:
- LINK_EXISTING
- CREATE_NEW
- UNCERTAIN
- REJECT

Identity confirmation **tidak** berarti semua source attributes otomatis confirmed.

Contoh Resident result:
- National ID → Identifier jika policy mengizinkan;
- canonical name/alias → Entity identity;
- address → Claim;
- employer → Claim/Relationship;
- organization membership → Claim/Relationship.

## 10. Case vs Workspace Knowledge

### Case Knowledge
- investigation-specific;
- dapat unverified/supported/conflicted;
- evidence dan context Case.

### Workspace Knowledge
- reusable lintas Case;
- lebih konservatif;
- explicit promotion;
- provenance jelas.

## 11. Promotion

```text
Case Claim/Relationship
→ Promotion Review
→ Workspace Claim/Relationship
```

Jangan hanya mengganti scope record lama; promotion sebaiknya memiliki lineage/decision sendiri.

## 12. Cross-Case Confidentiality

Entity existence dapat diketahui tanpa membuka Case lain.

Permission yang berbeda:
- DISCOVER_ENTITY_EXISTENCE
- VIEW_CROSS_CASE_CONTEXT
- VIEW_CROSS_CASE_EVIDENCE

UI dapat mengatakan “existing workspace entity found” tanpa menyebut Case rahasia lain.

## 13. Merge & Split

Merge harus:
- auditable;
- non-destructive;
- survivor jelas;
- old Entity ID tetap resolvable;
- reversible/splittable.

```text
PERSON-882
status: MERGED
mergedInto: PERSON-001
```

Knowledge history tidak dihapus.

## 14. Knowledge Revision

Jika Workspace Relationship salah:
- revision/revoke, jangan delete;
- affected Cases dapat menerima highlight/notification;
- Finding historical tidak otomatis ditulis ulang.

## 15. SPECTRA Menemukan B

```text
News Evidence
→ Entity Extraction
→ Candidate-B
→ RelationshipCandidate A MET_WITH B
```

ECHO menampilkan tentative edge.

Action `Investigate B in SHADOW`:
```text
create Subject B
→ SubjectSeed from Evidence
→ search existing Entity
→ lookup jika perlu
→ Resolution
→ PERSON-B
```

ECHO kemudian dapat review `A MET_WITH PERSON-B` menjadi Case Relationship.

Identities reusable Workspace-level; relationship contextual tetap Case-level kecuali explicit promotion.
