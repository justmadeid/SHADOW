import { Module } from "@nestjs/common";
import { AuditModule, AuditFacade } from "../audit/index.js";
import { ClassificationPolicy } from "./application/classification-policy.js";
import { AuditedDataAccess } from "./application/audited-data-access.js";

import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "../../platform/request-context/index.js";
import { PostgresOutboxStore } from "../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import { CaseMembershipFacade } from "./application/case-membership.facade.js";
import { PostgresCaseMembershipStore } from "./infrastructure/persistence/postgres-case-membership.store.js";
import { PolicyEnforcer } from "./application/policy-enforcer.js";
import { PostgresGovernanceRepository } from "./infrastructure/persistence/postgres-governance.repository.js";
import { GOVERNANCE_REPOSITORY, CASE_MEMBERSHIP_STORE } from "./governance.tokens.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, AuditModule],
  providers: [
    {
      provide: CASE_MEMBERSHIP_STORE,
      inject: [DatabaseContext, RequestContextStore, AuditFacade],
      useFactory: (
        database: DatabaseContext,
        context: RequestContextStore,
        audit: AuditFacade,
      ) =>
        new PostgresCaseMembershipStore(
          database,
          new PostgresOutboxStore(database, context),
          audit,
        ),
    },
    {
      provide: GOVERNANCE_REPOSITORY,
      inject: [DatabaseContext],
      useFactory: (database: DatabaseContext) =>
        new PostgresGovernanceRepository(database),
    },
    PolicyEnforcer,
    ClassificationPolicy,
    AuditedDataAccess,
    CaseMembershipFacade,
  ],
  exports: [
    PolicyEnforcer,
    CaseMembershipFacade,
    ClassificationPolicy,
    AuditedDataAccess,
  ],
})
export class GovernanceModule {}
