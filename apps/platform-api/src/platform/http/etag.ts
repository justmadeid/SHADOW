import { AppError } from "../errors/index.js";

export function etagForRevision(revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Revision must be a non-negative safe integer");
  }

  return `"${revision}"`;
}

export function parseIfMatchRevision(
  headerValue: string | undefined,
): number | undefined {
  if (headerValue === undefined) {
    return undefined;
  }

  const match = /^"(\d+)"$/.exec(headerValue.trim());

  if (!match) {
    throw new AppError({
      code: "VALIDATION_INVALID_IF_MATCH",
      message: "If-Match must contain a quoted resource revision.",
      statusCode: 400,
    });
  }

  const revision = Number(match[1]);

  if (!Number.isSafeInteger(revision)) {
    throw new AppError({
      code: "VALIDATION_INVALID_IF_MATCH",
      message: "If-Match revision is invalid.",
      statusCode: 400,
    });
  }

  return revision;
}

export function assertExpectedRevision(
  expected: number | undefined,
  actual: number,
): void {
  if (expected === undefined) {
    return;
  }

  if (expected !== actual) {
    throw new AppError({
      code: "CONFLICT_REVISION_MISMATCH",
      message: "The resource has changed since it was read.",
      statusCode: 412,
      details: {
        expectedRevision: expected,
        actualRevision: actual,
      },
    });
  }
}
