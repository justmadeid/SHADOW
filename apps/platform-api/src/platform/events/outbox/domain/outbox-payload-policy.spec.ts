import { describe, expect, it } from "vitest";

import { assertSafeOutboxPayload } from "./outbox-payload-policy.js";

describe("Outbox payload policy", () => {
  it("accepts small reference-oriented payloads", () => {
    expect(() =>
      assertSafeOutboxPayload({
        runId: "0198-test-run",
        operation: "EXECUTION_REQUESTED",
      }),
    ).not.toThrow();
  });

  it.each([
    ["nik", "123"],
    ["nationalId", "123"],
    ["email", "person@example.invalid"],
    ["accessToken", "secret"],
    ["rawPayload", "source-response"],
  ])("rejects sensitive key %s", (key, value) => {
    expect(() =>
      assertSafeOutboxPayload({
        nested: {
          [key]: value,
        },
      }),
    ).toThrow();
  });

  it("rejects oversized payloads", () => {
    expect(() =>
      assertSafeOutboxPayload(
        {
          data: "x".repeat(2_000),
        },
        {
          maxBytes: 100,
        },
      ),
    ).toThrow();
  });
});
