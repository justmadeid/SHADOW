import { Module } from "@nestjs/common";

import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { WorkspaceFacade } from "./application/workspace.facade.js";
import { PostgresWorkspaceRepository } from "./infrastructure/persistence/postgres-workspace.repository.js";
import { WorkspaceController } from "./presentation/http/workspace.controller.js";
import { WORKSPACE_REPOSITORY } from "./workspace.tokens.js";

@Module({
  imports: [DatabaseModule, RequestContextModule],
  controllers: [WorkspaceController],
  providers: [
    {
      provide: PostgresOutboxStore,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresOutboxStore(database, context),
    },
    {
      provide: WORKSPACE_REPOSITORY,
      inject: [DatabaseContext, PostgresOutboxStore],
      useFactory: (database: DatabaseContext, outbox: PostgresOutboxStore) =>
        new PostgresWorkspaceRepository(database, outbox),
    },
    WorkspaceFacade,
  ],
  exports: [WorkspaceFacade],
})
export class WorkspaceModule {}
