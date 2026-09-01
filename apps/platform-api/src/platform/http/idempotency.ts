import { AppError } from "../errors/index.js";

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

const SAFE_KEY = /^[A-Za-z0-9._~:+/-]{8,200}$/;

export function parseIdempotencyKey(
  value: string | undefined,
  options: { required?: boolean } = {},
): string | undefined {
  if (!value) {
    if (options.required) {
      throw new AppError({
        code: "VALIDATION_IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key is required for this operation.",
        statusCode: 400,
      });
    }

    return undefined;
  }

  if (!SAFE_KEY.test(value)) {
    throw new AppError({
      code: "VALIDATION_INVALID_IDEMPOTENCY_KEY",
      message: "Idempotency-Key contains unsupported characters or length.",
      statusCode: 400,
    });
  }

  return value;
}
