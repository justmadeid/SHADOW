import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPlatformLogger } from "./logger.js";

describe("PII-safe logger", () => {
  it("keeps request context while redacting direct and nested sensitive fields", () => {
    let output = "";
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });

    const requestId = "01991b8b-7c00-7000-8000-000000000001";
    const sensitiveValues = {
      nik: "synthetic-nik-value",
      phone: "synthetic-phone-value",
      email: "synthetic-email-value",
      authorization: "synthetic-authorization-value",
    };
    const logger = createPlatformLogger({ level: "info" }, sink);

    logger.info(
      {
        event: "http.request.completed",
        requestId,
        ...sensitiveValues,
        subject: sensitiveValues,
      },
      "Request completed",
    );

    const record = JSON.parse(output) as Record<string, unknown>;
    const serialized = JSON.stringify(record);

    expect(record.requestId).toBe(requestId);
    expect(record.nik).toBe("[REDACTED]");
    expect(record.subject).toEqual({
      nik: "[REDACTED]",
      phone: "[REDACTED]",
      email: "[REDACTED]",
      authorization: "[REDACTED]",
    });

    for (const value of Object.values(sensitiveValues)) {
      expect(serialized).not.toContain(value);
    }

    sink.end();
  });
});
