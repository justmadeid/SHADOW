#!/usr/bin/env node

import net from "node:net";
import process from "node:process";

const checks = [
  {
    name: "PostgreSQL",
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
  },
  {
    name: "Redis",
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  {
    name: "MinIO API",
    host: process.env.MINIO_HOST ?? "127.0.0.1",
    port: Number(process.env.MINIO_API_PORT ?? 9000),
  },
  {
    name: "Investigation Elasticsearch",
    host: process.env.ELASTICSEARCH_HOST ?? "127.0.0.1",
    port: Number(process.env.ELASTICSEARCH_PORT ?? 9200),
  },
  {
    name: "OTel Collector",
    host: process.env.OTEL_HOST ?? "127.0.0.1",
    port: Number(process.env.OTEL_GRPC_PORT ?? 4317),
  },
  {
    name: "Jaeger UI",
    host: process.env.JAEGER_HOST ?? "127.0.0.1",
    port: Number(process.env.JAEGER_UI_PORT ?? 16686),
  },
];

function probe({ host, port, name }) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    const finish = (ok, detail) => {
      socket.destroy();
      resolve({ name, host, port, ok, detail });
    };

    socket.setTimeout(1500);

    socket.once("connect", () => finish(true, "reachable"));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => finish(false, error.code ?? error.message));
  });
}

const results = await Promise.all(checks.map(probe));

let failed = 0;

for (const result of results) {
  const marker = result.ok ? "✓" : "✗";
  console.log(
    `${marker} ${result.name.padEnd(28)} ${result.host}:${result.port} ${result.detail}`,
  );

  if (!result.ok) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} infrastructure dependency check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nLocal infrastructure ports are reachable.");
}
