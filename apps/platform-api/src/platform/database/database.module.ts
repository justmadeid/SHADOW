import { Global, Module } from "@nestjs/common";
import { loadPlatformApiConfig } from "@intelligence/config";
import {
  createDatabaseClient,
  DatabaseContext,
  DrizzleTransactionManager,
} from "@intelligence/database";

export const PLATFORM_DB_POOL = Symbol("PLATFORM_DB_POOL");
export const PLATFORM_DB_CLIENT = Symbol("PLATFORM_DB_CLIENT");

@Global()
@Module({
  providers: [
    {
      provide: PLATFORM_DB_CLIENT,
      useFactory: () => {
        const config = loadPlatformApiConfig();
        return createDatabaseClient({
          databaseUrl: config.DATABASE_URL,
          applicationName: "intelligence-platform-api",
        });
      },
    },
    {
      provide: PLATFORM_DB_POOL,
      inject: [PLATFORM_DB_CLIENT],
      useFactory: (client: ReturnType<typeof createDatabaseClient>) => client.pool,
    },
    {
      provide: DatabaseContext,
      inject: [PLATFORM_DB_CLIENT],
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        new DatabaseContext(client.db),
    },
    {
      provide: DrizzleTransactionManager,
      inject: [PLATFORM_DB_CLIENT],
      useFactory: (client: ReturnType<typeof createDatabaseClient>) =>
        new DrizzleTransactionManager(client.db),
    },
  ],
  exports: [PLATFORM_DB_POOL, DatabaseContext, DrizzleTransactionManager],
})
export class DatabaseModule {}
