# Implementation Architecture Gates

Dokumen ini digunakan sebagai checklist PR/epic agar implementasi tidak menyimpang dari architecture baseline.

## 1. Domain Ownership Gate

Sebelum merge, jawab:
- Domain mana yang owns resource ini?
- Apakah code menulis table/repository domain lain secara langsung?
- Apakah SHADOW/ECHO/SPECTRA dipakai sebagai backend business module? Jika ya, desain harus direview.

## 2. Identity Gate

Untuk data tentang orang/account:
- apakah ini Subject, Candidate, Entity, Claim, Relationship, atau Evidence?
- apakah Candidate secara tidak sengaja dibuat canonical?
- apakah Case menduplikasi Entity?
- apakah sensitive identifiers masked dan governed?

## 3. Knowledge Gate

- apakah machine output auto-confirmed sebagai Knowledge?
- apakah Case Knowledge auto-promoted ke Workspace?
- apakah revision/conflict history dipertahankan?
- apakah relationship type berasal dari controlled ontology?

## 4. Evidence Gate

- SourceRecord/Observation/Evidence semantic dipisahkan?
- provenance Source → Connector → Run tersedia?
- raw persistence sesuai DataSource policy?
- edited/deleted observations preserving history?
- worker tidak direct insert canonical knowledge?

## 5. Dataset/Analysis Gate

- analysis menggunakan immutable DatasetSnapshot?
- completeness explicit?
- model/version/configuration tercatat?
- output tidak overwrite Evidence?
- candidates masuk review/resolution path?

## 6. Execution Gate

- Run + Outbox atomic?
- Run ≠ ExecutionAttempt?
- job idempotent?
- business retry membuat Run baru?
- checkpoint/versioning benar?
- progress tidak fake percentage?
- secret tidak masuk job payload?

## 7. Governance Gate

- authorization dilakukan sebelum protected action?
- permission-to-use dibedakan dari permission-to-view?
- cross-case disclosure minimal?
- restricted reasonForAccess dicatat?
- field masking server-side?

## 8. Audit Gate

Critical action menghasilkan durable audit intent/event?

Critical examples:
- restricted lookup;
- entity merge/split;
- candidate resolution;
- knowledge promotion/revocation;
- finding approval/retraction;
- evidence export;
- permission changes.

## 9. API Gate

- route mengikuti canonical domain ownership?
- `202` hanya untuk actual long-running operations?
- error code machine-readable?
- cursor pagination untuk high-volume?
- ETag/revision digunakan pada mutable shared resources?
- Idempotency-Key untuk duplicate-sensitive POST?
- OpenAPI/client regenerated?

## 10. Frontend Product Boundary Gate

Forbidden:
```text
shadow → echo internals
echo → spectra internals
spectra → shadow internals
```

Allowed cross-product mechanisms:
- ResourceRef;
- DeepLinkTarget;
- Platform API;
- shared stable contracts.

## 11. Observability Gate

- traceId/requestId/runId/attemptId tersedia bila relevan?
- no raw PII in logs/metrics?
- high-cardinality IDs tidak dipakai metric labels?
- external call latency/error instrumented?

## 12. Reasoning Gate

Untuk Hypothesis/Finding:
- supporting dan contradicting resources dapat coexist?
- confidence mempunyai rationale?
- approved Finding immutable-ish?
- resource revision/version pinned bila mutable?
- Analysis/Alert tidak auto-create approved Finding?

## 13. Extraction-Readiness Gate

Jika domain/product dipisahkan menjadi service/app terpisah besok:
- apakah dependencies sudah melalui facade/contracts?
- apakah direct cross-module SQL akan menjadi blocker?
- apakah URL fisik disimpan sebagai domain data?
- apakah source-specific details bocor ke generic workflow/domain?

Jika jawabannya ya, lakukan architecture review sebelum merge.
