import { describe, expect, it } from "vitest";
import { AppError } from "../errors/index.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { assertExpectedRevision, etagForRevision, parseIfMatchRevision } from "./etag.js";
import { parseIdempotencyKey } from "./idempotency.js";

function expectAppError(action: () => unknown, code: string, statusCode: number): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code, statusCode });
    return;
  }

  throw new Error(`Expected AppError ${code}`);
}

describe("public API primitives contract", () => {
  it("round-trips an opaque, versioned cursor and rejects malformed cursors", () => {
    const payload = { createdAt: "2026-09-01T00:00:00.000Z", id: "resource-1" };
    const cursor = encodeCursor(payload);

    expect(cursor).not.toContain(payload.id);
    expect(decodeCursor<typeof payload>(cursor)).toEqual(payload);
    expectAppError(
      () => decodeCursor("not-a-valid-cursor"),
      "VALIDATION_INVALID_CURSOR",
      400,
    );
  });

  it("uses quoted revisions for optimistic concurrency", () => {
    expect(etagForRevision(7)).toBe('"7"');
    expect(parseIfMatchRevision('"7"')).toBe(7);
    expect(parseIfMatchRevision(undefined)).toBeUndefined();
    expect(() => assertExpectedRevision(7, 7)).not.toThrow();
    expectAppError(() => assertExpectedRevision(7, 8), "CONFLICT_REVISION_MISMATCH", 412);
  });

  it("requires safe idempotency keys when an operation declares them required", () => {
    expect(parseIdempotencyKey("request-1234", { required: true })).toBe("request-1234");
    expectAppError(
      () => parseIdempotencyKey(undefined, { required: true }),
      "VALIDATION_IDEMPOTENCY_KEY_REQUIRED",
      400,
    );
    expectAppError(
      () => parseIdempotencyKey("short", { required: true }),
      "VALIDATION_INVALID_IDEMPOTENCY_KEY",
      400,
    );
  });
});
