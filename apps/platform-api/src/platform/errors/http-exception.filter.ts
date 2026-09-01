import {
  ArgumentsHost,
  Catch,
  HttpException,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import type { Logger } from "pino";

import { RequestContextStore } from "../request-context/index.js";
import { AppError } from "./app-error.js";
import type { ErrorResponse } from "./error-response.js";

@Catch()
export class PlatformExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly contextStore: RequestContextStore,
    private readonly logger: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestContext = this.contextStore.getOptional();

    const mapped = this.map(exception);

    if (mapped.statusCode >= 500) {
      this.logger.error(
        {
          event: "http.request.failed",
          requestId: requestContext?.requestId,
          traceId: requestContext?.traceId,
          errorCode: mapped.code,
          error: exception,
        },
        "Unhandled request failure",
      );
    }

    const visibleDetails = mapped.exposeDetails ? mapped.details : undefined;
    const body: ErrorResponse = {
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId: requestContext?.requestId ?? "unknown",
        ...(visibleDetails ? { details: visibleDetails } : {}),
      },
    };

    response.status(mapped.statusCode).json(body);
  }

  private map(exception: unknown): {
    code: string;
    message: string;
    statusCode: number;
    details?: Record<string, unknown>;
    exposeDetails: boolean;
  } {
    if (exception instanceof AppError) {
      return {
        code: exception.code,
        message: exception.message,
        statusCode: exception.statusCode,
        ...(exception.details ? { details: exception.details } : {}),
        exposeDetails: exception.statusCode < 500,
      };
    }

    if (exception instanceof HttpException) {
      return {
        code: "HTTP_ERROR",
        message: exception.message,
        statusCode: exception.getStatus(),
        exposeDetails: false,
      };
    }

    return {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      statusCode: 500,
      exposeDetails: false,
    };
  }
}
