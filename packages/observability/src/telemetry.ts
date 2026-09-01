import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export type TelemetryOptions = {
  serviceName: string;
  serviceVersion?: string;
  otlpEndpoint?: string;
};

export function createTelemetrySdk(options: TelemetryOptions): NodeSDK {
  const endpoint =
    options.otlpEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://127.0.0.1:4318";

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
  });

  return new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion ?? "0.0.0-dev",
    }),

    traceExporter,

    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10_000,
    }),

    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-http": {
          // Prevent high-value secret-bearing headers from being copied into
          // custom telemetry attributes by application code.
          headersToSpanAttributes: {
            client: {
              requestHeaders: [],
              responseHeaders: [],
            },
            server: {
              requestHeaders: [],
              responseHeaders: [],
            },
          },
        },
      }),
    ],
  });
}
