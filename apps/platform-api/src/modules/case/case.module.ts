import { Module } from "@nestjs/common";

import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { WorkspaceModule } from "../workspace/index.js";
import { GovernanceModule } from "../governance/index.js";
import { CaseFacade } from "./application/case.facade.js";
import { PostgresCaseRepository } from "./infrastructure/persistence/postgres-case.repository.js";
import { CaseController } from "./presentation/http/case.controller.js";
import { CASE_REPOSITORY } from "./case.tokens.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, WorkspaceModule, GovernanceModule],
  controllers: [CaseController],
  providers: [
    {
      provide: PostgresOutboxStore,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresOutboxStore(database, context),
    },
    {
      provide: CASE_REPOSITORY,
      inject: [DatabaseContext, PostgresOutboxStore],
      useFactory: (database: DatabaseContext, outbox: PostgresOutboxStore) =>
        new PostgresCaseRepository(database, outbox),
    },
    CaseFacade,
  ],
  exports: [CaseFacade],
})
export class CaseModule {}
