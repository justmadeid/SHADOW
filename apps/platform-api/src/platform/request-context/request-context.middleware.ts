import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { trace } from "@opentelemetry/api";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { v7 as uuidv7 } from "uuid";
import { PLATFORM_LOGGER } from "../observability/logging/logger.module.js";
import { RequestContextStore } from "./request-context.store.js";
import type { ClientApplication, RequestContext } from "./request-context.js";

function clientApplication(value: string | undefined): ClientApplication {
  switch (value) {
    case "SHADOW":
    case "ECHO":
    case "SPECTRA":
    case "INTERNAL_WORKER":
      return value;
    default:
      return "UNKNOWN";
  }
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    @Inject(RequestContextStore)
    private readonly store: RequestContextStore,
    @Inject(PLATFORM_LOGGER) private readonly logger: Logger,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = uuidv7();
    const spanContext = trace.getActiveSpan()?.spanContext();

    const context: RequestContext = {
      requestId,
      traceId: spanContext?.traceId ?? requestId.replaceAll("-", "").slice(0, 32),
      clientApplication: clientApplication(
        req.header("x-client-application") ?? undefined,
      ),
      issuedAt: new Date().toISOString(),
    };

    res.setHeader("x-request-id", requestId);
    const startedAt = process.hrtime.bigint();

    res.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

      this.logger.info(
        {
          event: "http.request.completed",
          requestId: context.requestId,
          traceId: context.traceId,
          clientApplication: context.clientApplication,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs,
        },
        "Request completed",
      );
    });

    this.store.run(context, next);
  }
}
