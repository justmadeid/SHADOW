import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { loadPlatformApiConfig } from "@intelligence/config";
import { AppModule } from "./app.module.js";
import { startTelemetry, stopTelemetry } from "./bootstrap/telemetry.js";

async function bootstrap(): Promise<void> {
  await startTelemetry();

  const config = loadPlatformApiConfig();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
  });

  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableShutdownHooks();
  await app.listen(config.APP_PORT, "0.0.0.0");

  const shutdown = async () => {
    await app.close();
    await stopTelemetry();
  };

  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

void bootstrap();
