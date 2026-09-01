import { createTelemetrySdk } from "@intelligence/observability";

export const telemetrySdk = createTelemetrySdk({
  serviceName: "platform-api",
  ...(process.env.APP_VERSION ? { serviceVersion: process.env.APP_VERSION } : {}),
});

export async function startTelemetry(): Promise<void> {
  await telemetrySdk.start();
}

export async function stopTelemetry(): Promise<void> {
  await telemetrySdk.shutdown();
}
