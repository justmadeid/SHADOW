import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { Logger } from "pino";
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
  imports: [RequestContextModule, LoggingModule, DatabaseModule, HealthModule],
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
