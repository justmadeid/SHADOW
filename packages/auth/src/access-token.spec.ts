import { describe, expect, it } from "vitest";

import { AccessTokenVerificationError, parseBearerAccessToken } from "./access-token.js";

describe("parseBearerAccessToken", () => {
  it("extracts a bearer token without changing its value", () => {
    expect(parseBearerAccessToken("Bearer header.payload.signature")).toBe(
      "header.payload.signature",
    );
  });

  it.each([
    undefined,
    "",
    "Basic credential",
    "Bearer",
    "Bearer one,two",
    `Bearer ${"x".repeat(16_385)}`,
  ])("rejects missing or malformed authorization values", (value) => {
    expect(() => parseBearerAccessToken(value)).toThrow(AccessTokenVerificationError);
  });
});
