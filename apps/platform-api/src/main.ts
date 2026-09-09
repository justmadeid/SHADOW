import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { DatabaseContext } from "@intelligence/database";
import { loadPlatformApiConfig } from "@intelligence/config";
import { AppModule } from "./app.module.js";
import { startOutboxDispatchLoop } from "./bootstrap/outbox-dispatch.js";
import { startTelemetry, stopTelemetry } from "./bootstrap/telemetry.js";
import { PLATFORM_LOGGER } from "./platform/observability/logging/logger.module.js";

async function bootstrap(): Promise<void> {
  await startTelemetry();

  const config = loadPlatformApiConfig();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableShutdownHooks();
  await app.listen(config.APP_PORT, "0.0.0.0");

  const outboxDispatch = startOutboxDispatchLoop(
    app.get(DatabaseContext),
    config.REDIS_URL,
    app.get(PLATFORM_LOGGER),
  );

  const shutdown = async () => {
    await outboxDispatch.stop();
    await app.close();
    await stopTelemetry();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void bootstrap();
