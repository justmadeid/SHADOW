import { Module } from "@nestjs/common";
import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { CaseModule } from "../case/index.js";
import { WorkflowModule } from "../workflow/index.js";
import { ExecutionAttemptFacade } from "./application/execution-attempt.facade.js";
import { RunFacade } from "./application/run.facade.js";
import { EXECUTION_ATTEMPT_REPOSITORY } from "./domain/execution-attempt-repository.js";
import { RUN_REPOSITORY } from "./domain/run-repository.js";
import { PostgresExecutionAttemptRepository } from "./infrastructure/persistence/postgres-execution-attempt.repository.js";
import { PostgresRunRepository } from "./infrastructure/persistence/postgres-run.repository.js";
import { ExecutionAttemptController } from "./presentation/http/execution-attempt.controller.js";
import { RunController } from "./presentation/http/run.controller.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, CaseModule, WorkflowModule],
  controllers: [RunController, ExecutionAttemptController],
  providers: [
    {
      provide: PostgresOutboxStore,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresOutboxStore(database, context),
    },
    {
      provide: RUN_REPOSITORY,
      inject: [DatabaseContext, PostgresOutboxStore],
      useFactory: (database: DatabaseContext, outbox: PostgresOutboxStore) =>
        new PostgresRunRepository(database, outbox),
    },
    {
      provide: EXECUTION_ATTEMPT_REPOSITORY,
      inject: [DatabaseContext, PostgresOutboxStore],
      useFactory: (database: DatabaseContext, outbox: PostgresOutboxStore) =>
        new PostgresExecutionAttemptRepository(database, outbox),
    },
    RunFacade,
    ExecutionAttemptFacade,
  ],
  exports: [RunFacade, ExecutionAttemptFacade],
})
export class ExecutionModule {}
