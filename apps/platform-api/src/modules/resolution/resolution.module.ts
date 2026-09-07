import { Module } from "@nestjs/common";
import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { SubjectModule } from "../subject/index.js";
import { ResolutionFacade } from "./application/resolution.facade.js";
import { RESOLUTION_REPOSITORY } from "./domain/resolution-repository.js";
import { PostgresResolutionRepository } from "./infrastructure/persistence/postgres-resolution.repository.js";
import { ResolutionController } from "./presentation/http/resolution.controller.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, SubjectModule],
  controllers: [ResolutionController],
  providers: [
    {
      provide: RESOLUTION_REPOSITORY,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresResolutionRepository(
          database,
          new PostgresOutboxStore(database, context),
        ),
    },
    ResolutionFacade,
  ],
  exports: [ResolutionFacade],
})
export class ResolutionModule {}
