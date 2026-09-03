import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { Logger } from "pino";
import { CaseModule } from "./modules/case/index.js";
import { WorkspaceModule } from "./modules/workspace/index.js";
import { AuthenticationModule } from "./platform/auth/index.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { PlatformExceptionFilter } from "./platform/errors/http-exception.filter.js";
import { HealthModule } from "./platform/health/health.module.js";
import {
  LoggingModule,
  PLATFORM_LOGGER,
} from "./platform/observability/logging/logger.module.js";
import {
  RequestContextModule,
  RequestContextStore,
} from "./platform/request-context/index.js";
import { SystemController } from "./presentation/shared/system.controller.js";

@Module({
  imports: [
    RequestContextModule,
    AuthenticationModule,
    LoggingModule,
    DatabaseModule,
    HealthModule,
    WorkspaceModule,
    CaseModule,
  ],
  controllers: [SystemController],
  providers: [
    {
      provide: APP_FILTER,
      inject: [RequestContextStore, PLATFORM_LOGGER],
      useFactory: (context: RequestContextStore, logger: Logger) =>
        new PlatformExceptionFilter(context, logger),
    },
  ],
})
export class AppModule {}
