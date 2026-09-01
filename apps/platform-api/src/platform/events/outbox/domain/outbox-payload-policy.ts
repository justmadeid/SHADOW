import { AppError } from "../../../errors/index.js";
import type { JsonObject, JsonValue } from "./outbox-event.js";

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_DEPTH = 12;

const FORBIDDEN_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /api[_-]?key/i,
  /^nik$/i,
  /national[_-]?id/i,
  /phone/i,
  /email/i,
  /raw[_-]?payload/i,
  /credential/i,
];

export function assertSafeOutboxPayload(
  payload: JsonObject,
  options: {
    maxBytes?: number;
    maxDepth?: number;
  } = {},
): void {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  inspectValue(payload, "$", 0, maxDepth);

  const serialized = JSON.stringify(payload);
  const size = Buffer.byteLength(serialized, "utf8");

  if (size > maxBytes) {
    throw new AppError({
      code: "OUTBOX_PAYLOAD_TOO_LARGE",
      message: "Outbox payload exceeds the permitted size.",
      statusCode: 500,
      details: {
        size,
        maxBytes,
      },
    });
  }
}

function inspectValue(
  value: JsonValue,
  path: string,
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth) {
    throw new AppError({
      code: "OUTBOX_PAYLOAD_TOO_DEEP",
      message: "Outbox payload nesting exceeds the permitted depth.",
      statusCode: 500,
    });
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectValue(entry, `${path}[${index}]`, depth + 1, maxDepth),
    );
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new AppError({
        code: "OUTBOX_SENSITIVE_FIELD_FORBIDDEN",
        message: "Sensitive data must not be written to the Outbox payload.",
        statusCode: 500,
        details: {
          field: key,
          path,
        },
      });
    }

    inspectValue(child, `${path}.${key}`, depth + 1, maxDepth);
  }
}
