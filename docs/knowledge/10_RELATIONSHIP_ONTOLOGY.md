# Relationship Ontology

Dokumen ini mencegah istilah relationship digunakan sembarangan dan membantu developer/analyst memiliki semantics yang sama.

## 1. Tiga Kelas Relasi

### Knowledge Relationship
Relasi Entity-to-Entity yang berada dalam Case/Workspace Knowledge.

### Evidence Relation
Relasi yang langsung terlihat pada content/source.

### Relationship Candidate
Relasi hasil extraction/analysis yang belum confirmed.

Ketiganya tidak boleh dianggap setara.

## 2. Knowledge Relationship Structure

```text
Relationship
├── id
├── scope
├── sourceEntityId
├── relationshipType
├── targetEntityId
├── status
├── confidence
├── validFrom?
├── validUntil?
├── evidenceRefs[]
├── createdBy
└── confirmedBy?
```

## 3. Status

Recommended:
- UNVERIFIED
- SUPPORTED
- CONFIRMED
- CONFLICTED
- REVOKED

## 4. Controlled Relationship Types

### Identity / Attribution
- ATTRIBUTED_TO
- SELF_DECLARED_ACCOUNT
- ATTRIBUTED_ACCOUNT
- VERIFIED_ACCOUNT
- USES
- REGISTERED_TO

### Organization / Membership
- WORKS_FOR
- MEMBER_OF
- OWNS
- MANAGES
- REPRESENTS
- AFFILIATED_WITH

### Communication / Social
- COMMUNICATED_WITH
- FOLLOWS
- INTERACTS_WITH

### Location / Event
- LOCATED_AT
- RESIDES_AT
- VISITED
- MET_AT
- ATTENDED
- MET_WITH
- PARTICIPATED_IN

### Association
- ASSOCIATED_WITH
- RELATED_TO (gunakan hanya jika relasi yang lebih spesifik tidak dapat dipertanggungjawabkan)

### Digital / Technical
- USES_DOMAIN
- USES_DEVICE
- RESOLVES_TO
- HOSTED_ON
- CONNECTED_TO

Ontology dapat berkembang tetapi setiap predicate baru harus memiliki definisi semantics yang jelas.

## 5. Social Attribution

Hindari claim berlebihan seperti `Person OWNS Account` jika evidence hanya menunjukkan kemungkinan attribution.

Gunakan relation yang lebih presisi dan status/confidence/provenance yang jelas.

## 6. Evidence Relation Types

Untuk social/media content:
- AUTHORED_BY
- MENTIONS
- REPLY_TO
- QUOTE_OF
- REPOST_OF
- REFERENCES
- CONTAINS_MEDIA
- LINKS_TO

Example:
```text
POST-1 MENTIONS ACCOUNT-B
```

tidak otomatis berarti:
```text
PERSON-A ASSOCIATED_WITH PERSON-B
```

## 7. Relationship Candidate

Example:
```text
source = PERSON-A
predicate = MET_WITH
target = Candidate-B
evidence = NEWS-100
confidence = MEDIUM
status = UNVERIFIED
```

Setelah B resolved ke `PERSON-B`, candidate dapat direbind tetapi tetap memerlukan review.

## 8. Temporal Relationship

Relasi tertentu wajib memiliki validity period.

```text
PERSON-A WORKS_FOR ORG-B
validFrom = 2024-01-01
validUntil = 2025-12-31
```

Jangan overwrite history hanya karena keadaan saat ini berubah.

## 9. Case vs Workspace Relationship

Case relationship dapat contextual/temporal/sensitive. Workspace relationship harus cukup stable dan reusable serta melalui explicit promotion.

## 10. ECHO Activity Aggregation

SPECTRA activity dapat tampil:
```text
ACCOUNT-A -- 142 mentions --> ACCOUNT-B
```

Ini activity overlay, bukan canonical relationship. Investigator dapat inspect, open in SPECTRA, atau mengangkatnya menjadi RelationshipCandidate untuk review.

## 11. Claim vs Relationship

Claim:
```text
PERSON-A DATE_OF_BIRTH 1990-01-01
```

Relationship:
```text
PERSON-A WORKS_FOR ORG-B
```

Gunakan struktur yang paling tepat dan jangan memaksa semua information menjadi graph edge.
