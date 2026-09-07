import { Module } from "@nestjs/common";
import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import { CaseModule } from "../case/index.js";
import { InvestigationModule } from "../investigation/index.js";
import { SUBJECT_REPOSITORY } from "./domain/subject-repository.js";
import { PostgresSubjectRepository } from "./infrastructure/persistence/postgres-subject.repository.js";
import { SubjectFacade } from "./application/subject.facade.js";
import { SubjectController } from "./presentation/http/subject.controller.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, CaseModule, InvestigationModule],
  controllers: [SubjectController],
  providers: [
    {
      provide: SUBJECT_REPOSITORY,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (db: DatabaseContext, context: RequestContextStore) =>
        new PostgresSubjectRepository(db, new PostgresOutboxStore(db, context)),
    },
    SubjectFacade,
  ],
  exports: [SubjectFacade],
})
export class SubjectModule {}
