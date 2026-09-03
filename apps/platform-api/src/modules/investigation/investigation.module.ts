import { Module } from "@nestjs/common";

import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { CaseModule } from "../case/index.js";
import { InvestigationFacade } from "./application/investigation.facade.js";
import { PostgresInvestigationRepository } from "./infrastructure/persistence/postgres-investigation.repository.js";
import { InvestigationController } from "./presentation/http/investigation.controller.js";
import { INVESTIGATION_REPOSITORY } from "./investigation.tokens.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, CaseModule],
  controllers: [InvestigationController],
  providers: [
    {
      provide: PostgresOutboxStore,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresOutboxStore(database, context),
    },
    {
      provide: INVESTIGATION_REPOSITORY,
      inject: [DatabaseContext, PostgresOutboxStore],
      useFactory: (database: DatabaseContext, outbox: PostgresOutboxStore) =>
        new PostgresInvestigationRepository(database, outbox),
    },
    InvestigationFacade,
  ],
  exports: [InvestigationFacade],
})
export class InvestigationModule {}
