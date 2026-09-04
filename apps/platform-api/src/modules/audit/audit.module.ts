import { Module } from "@nestjs/common";
import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import { AuditFacade } from "./application/audit.facade.js";
import { PostgresAuditStore } from "./infrastructure/persistence/postgres-audit.store.js";
import { AUDIT_STORE } from "./audit.tokens.js";

@Module({
  imports: [DatabaseModule, RequestContextModule],
  providers: [
    AuditFacade,
    {
      provide: AUDIT_STORE,
      inject: [DatabaseContext, RequestContextStore],
      useFactory: (database: DatabaseContext, context: RequestContextStore) =>
        new PostgresAuditStore(database, new PostgresOutboxStore(database, context)),
    },
  ],
  exports: [AuditFacade],
})
export class AuditModule {}
