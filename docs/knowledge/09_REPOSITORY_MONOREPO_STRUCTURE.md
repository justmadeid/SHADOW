# Repository / Monorepo Structure

## 1. Decision

Fase awal menggunakan **hybrid frontend**: satu `platform-web` dengan product boundaries SHADOW/ECHO/SPECTRA yang extraction-ready.

Tujuan:
- flow mudah dimatangkan;
- shared Case context;
- konsistensi UX;
- perubahan konsep cepat;
- mudah dipisahkan menjadi app terpisah nanti.

## 2. Monorepo v1

```text
intelligence-platform/
├── apps/
│   ├── platform-web/
│   ├── platform-api/
│   ├── connector-worker/
│   ├── intelligence-worker/
│   └── indexing-worker/
│
├── packages/
│   ├── contracts/
│   ├── api-client/
│   ├── ui/
│   ├── canvas-kit/
│   ├── auth/
│   ├── connector-sdk/
│   ├── database/
│   ├── observability/
│   ├── config/
│   └── testing/
│
├── infrastructure/
├── docs/
└── tooling/
```

Existing Resident Hono API tetap separate repository/service karena merupakan source-side service.

## 3. platform-web

```text
apps/platform-web/src/
├── app/
├── shell/
├── products/
│   ├── shadow/
│   ├── echo/
│   └── spectra/
└── shared/
```

### shell owns
- auth context;
- workspace context;
- case context;
- navigation;
- notification center;
- realtime connection;
- global search;
- command palette;
- deep-link handling.

## 4. Product Isolation Rules

Allowed:
```text
SHADOW → contracts/api-client/ui
ECHO → contracts/api-client/ui/canvas-kit
SPECTRA → contracts/api-client/ui
```

Forbidden:
```text
SHADOW → ECHO internals
ECHO → SPECTRA internals
SPECTRA → SHADOW internals
```

Cross-product communication melalui API, ResourceRef, DeepLinkTarget, dan shared contracts.

## 5. State Boundaries

Global state hanya:
- current user;
- workspace;
- case;
- permissions;
- notifications;
- shell navigation.

Product-local:
- SHADOW workflow state;
- ECHO graph selection/layout;
- SPECTRA filters/timeline.

## 6. Shared Packages

### contracts
Transport/schema contracts: ResourceRef, IDs, enums, API DTO, errors, RealtimeEvent, IntelligenceHighlight, CaseCapabilitySummary.

### api-client
Typed client untuk Platform API, idealnya generated dari OpenAPI.

### ui
Design-system primitives; tidak berisi business pages.

### canvas-kit
Generic graph primitives, bukan Entity/Workflow business logic.

### connector-sdk
Standard connector contract dan runtime abstractions.

### database
Connection/migration/transaction/outbox infrastructure. Schema ownership tetap mengikuti backend module.

## 7. platform-api

```text
src/
├── bootstrap/
├── platform/
├── modules/
└── presentation/
```

Modules domain-based, bukan app-based.

## 8. Worker Deployables

### connector-worker
Berinteraksi dengan external/internal sources.

### intelligence-worker
Normalization, entity extraction, dataset materialization, analysis/identity processing yang membutuhkan asynchronous compute.

### indexing-worker
Membangun rebuildable Investigation Search Projection.

Realtime gateway tidak perlu dipisah pada MVP; SSE dapat tinggal di Platform API.

## 9. Future Extraction

Hari ini:
```text
platform-web/products/spectra
```

Future:
```text
apps/spectra-web
```

Extraction harus primarily membutuhkan perubahan deployment/routing/auth handoff, bukan rewrite feature logic.

## 10. Backend Split Rule

Frontend split tidak otomatis berarti backend split. Platform API tetap modular monolith sampai ada alasan nyata seperti scaling, security/failure isolation, team ownership, atau independent deployment.

## 11. Documentation Structure

```text
docs/
├── architecture/
├── domains/
├── contracts/
├── decisions/
└── diagrams/
```

Gunakan ADR untuk perubahan keputusan penting.
