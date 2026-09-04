import { Module } from "@nestjs/common";

import { DatabaseContext } from "@intelligence/database";
import { DatabaseModule } from "../../platform/database/database.module.js";
import { RequestContextModule } from "../../platform/request-context/index.js";
import { PolicyEnforcer } from "./application/policy-enforcer.js";
import { PostgresGovernanceRepository } from "./infrastructure/persistence/postgres-governance.repository.js";
import { GOVERNANCE_REPOSITORY } from "./governance.tokens.js";

@Module({
  imports: [DatabaseModule, RequestContextModule],
  providers: [
    {
      provide: GOVERNANCE_REPOSITORY,
      inject: [DatabaseContext],
      useFactory: (database: DatabaseContext) =>
        new PostgresGovernanceRepository(database),
    },
    PolicyEnforcer,
  ],
  exports: [PolicyEnforcer],
})
export class GovernanceModule {}
