import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { REDACTION_VALUE, SENSITIVE_LOG_PATHS } from "./redaction.js";

export function createPlatformLogger(
  options: LoggerOptions = {},
  destination?: DestinationStream,
): Logger {
  const loggerOptions: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? "info",
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,

    redact: {
      paths: [...SENSITIVE_LOG_PATHS],
      censor: REDACTION_VALUE,
    },

    serializers: {
      error(error: unknown) {
        if (!(error instanceof Error)) {
          return { type: typeof error };
        }

        return {
          name: error.name,
          message: error.message,
          // Stack is operational data and may still include source code paths.
          // Enable only in controlled environments.
          stack: process.env.APP_ENV === "production" ? undefined : error.stack,
        };
      },
    },
  };

  Object.assign(loggerOptions, options);

  return destination === undefined
    ? pino(loggerOptions)
    : pino(loggerOptions, destination);
}
