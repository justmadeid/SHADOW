import { Module } from "@nestjs/common";
import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { CaseModule } from "../case/index.js";
import { InvestigationModule } from "../investigation/index.js";
import { NodeDefinitionFacade } from "./application/node-definition.facade.js";
import { NodeInstanceFacade } from "./application/node-instance.facade.js";
import { NODE_INSTANCE_REPOSITORY } from "./domain/node-instance-repository.js";
import { PostgresNodeDefinitionRepository } from "./infrastructure/persistence/postgres-node-definition.repository.js";
import { PostgresNodeInstanceRepository } from "./infrastructure/persistence/postgres-node-instance.repository.js";
import { NodeDefinitionController } from "./presentation/http/node-definition.controller.js";
import { NodeInstanceController } from "./presentation/http/node-instance.controller.js";
import { NODE_DEFINITION_REGISTRY } from "./workflow.tokens.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, CaseModule, InvestigationModule],
  controllers: [NodeDefinitionController, NodeInstanceController],
  providers: [
    {
      provide: PostgresOutboxStore,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresOutboxStore(database, context),
    },
    {
      provide: NODE_DEFINITION_REGISTRY,
      inject: [DatabaseContext],
      useFactory: (database: DatabaseContext) =>
        new PostgresNodeDefinitionRepository(database),
    },
    {
      provide: NODE_INSTANCE_REPOSITORY,
      inject: [DatabaseContext, PostgresOutboxStore],
      useFactory: (database: DatabaseContext, outbox: PostgresOutboxStore) =>
        new PostgresNodeInstanceRepository(database, outbox),
    },
    NodeDefinitionFacade,
    NodeInstanceFacade,
  ],
  exports: [NodeDefinitionFacade, NodeInstanceFacade],
})
export class WorkflowModule {}
