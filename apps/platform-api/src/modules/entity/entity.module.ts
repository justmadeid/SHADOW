import { Module } from "@nestjs/common";
import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { AuditModule } from "../audit/index.js";
import { CaseModule } from "../case/index.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { GovernanceModule } from "../governance/index.js";
import { WorkspaceModule } from "../workspace/index.js";
import { EntityFacade } from "./application/entity.facade.js";
import { IdentifierFacade } from "./application/identifier.facade.js";
import { ENTITY_REPOSITORY } from "./domain/entity-repository.js";
import { IDENTIFIER_REPOSITORY } from "./domain/identifier-repository.js";
import { PostgresEntityRepository } from "./infrastructure/persistence/postgres-entity.repository.js";
import { PostgresIdentifierRepository } from "./infrastructure/persistence/postgres-identifier.repository.js";
import {
  EnvironmentIdentifierProtection,
  IDENTIFIER_PROTECTION,
  type IdentifierProtection,
} from "./infrastructure/security/identifier-protection.js";
import { EntityController } from "./presentation/http/entity.controller.js";
import { IdentifierController } from "./presentation/http/identifier.controller.js";

@Module({
  imports: [
    DatabaseModule,
    RequestContextModule,
    WorkspaceModule,
    GovernanceModule,
    AuditModule,
    CaseModule,
  ],
  controllers: [EntityController, IdentifierController],
  providers: [
    {
      provide: ENTITY_REPOSITORY,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresEntityRepository(
          database,
          new PostgresOutboxStore(database, context),
        ),
    },
    {
      provide: IDENTIFIER_PROTECTION,
      useClass: EnvironmentIdentifierProtection,
    },
    {
      provide: IDENTIFIER_REPOSITORY,
      inject: [DatabaseContext, RequestContextStore, IDENTIFIER_PROTECTION],
      useFactory: (
        database: DatabaseContext,
        context: RequestContextStore,
        protection: IdentifierProtection,
      ) =>
        new PostgresIdentifierRepository(
          database,
          new PostgresOutboxStore(database, context),
          protection,
        ),
    },
    EntityFacade,
    IdentifierFacade,
  ],
  exports: [EntityFacade, IdentifierFacade],
})
export class EntityModule {}
