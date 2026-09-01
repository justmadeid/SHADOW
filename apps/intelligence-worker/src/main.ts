import { createTelemetrySdk } from "@intelligence/observability";

const sdk = createTelemetrySdk({
  serviceName: "intelligence-worker",
  serviceVersion: process.env.APP_VERSION ?? "0.0.0-dev",
});

async function main(): Promise<void> {
  await sdk.start();
  console.log(
    JSON.stringify({ event: "worker.started", service: "intelligence-worker" }),
  );

  const keepAlive = setInterval(() => undefined, 60_000);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(keepAlive);
    console.log(
      JSON.stringify({ event: "worker.stopping", service: "intelligence-worker" }),
    );
    await sdk.shutdown();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main();
