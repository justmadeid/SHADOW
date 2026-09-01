# Backend Module Template

Use this as a starting point for a new Platform API domain module.

```text
modules/<module>/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── policies/
│   ├── events/
│   └── ports/
│
├── application/
│   ├── commands/
│   ├── queries/
│   ├── handlers/
│   └── facade/
│
├── infrastructure/
│   ├── persistence/
│   ├── adapters/
│   └── projections/
│
├── presentation/
│   └── http/
│
└── index.ts
```

## Domain
Contains business invariant.
Must not depend on NestJS HTTP, ORM implementation or external source SDK.

## Application
Coordinates use cases, transaction boundary and public facade.

## Infrastructure
Adapters:
- repository implementation;
- external client;
- projection writer.

## Presentation
Maps transport request/response to application commands/queries.

## Public `index.ts`

Expose only what other modules may depend on:
- facade/port;
- stable IDs/refs;
- public events/contracts when appropriate.

Do not export:
- ORM schema;
- repository implementation;
- persistence mapper;
- internal handler.

## Cross-module mutation example

Good:
```text
ResolutionCoordinator
→ EntityRegistryFacade.createEntity(...)
→ SubjectFacade.resolveSubject(...)
```

Bad:
```text
resolution service
→ INSERT entity_registry.entities
→ UPDATE subject.subject
```

## Events

Use domain/internal events for decoupled reactions.
Use durable outbox/integration event for cross-process effects.

Do not publish every trivial internal state change to BullMQ.

## Queries

Simple domain query: module facade/repository.

Complex UI aggregate:
dedicated presentation/read-model query; read-only and rebuildable when projection-based.
