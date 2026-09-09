import { AppError } from "../../../platform/errors/index.js";

export type CreateAttemptBody = { leaseOwner: string; leaseDurationSeconds: number };

export function parseCreateAttemptBody(value: unknown): CreateAttemptBody {
  const body = record(value, ["leaseOwner", "leaseDurationSeconds"]);
  if (
    typeof body.leaseOwner !== "string" ||
    body.leaseOwner.length < 1 ||
    body.leaseOwner.length > 200
  )
    invalid("leaseOwner");
  if (
    !Number.isSafeInteger(body.leaseDurationSeconds) ||
    (body.leaseDurationSeconds as number) < 1 ||
    (body.leaseDurationSeconds as number) > 300
  )
    invalid("leaseDurationSeconds");
  return {
    leaseOwner: body.leaseOwner,
    leaseDurationSeconds: body.leaseDurationSeconds as number,
  };
}

export type ProgressBody = {
  attemptId: string;
  stage: string;
  processed: number | null;
  produced: number | null;
  total: number | null;
};

export function parseProgressBody(value: unknown): ProgressBody {
  const body = record(value, ["attemptId", "stage", "processed", "produced", "total"]);
  if (typeof body.attemptId !== "string") invalid("attemptId");
  if (
    typeof body.stage !== "string" ||
    body.stage.trim().length < 1 ||
    body.stage.length > 64
  )
    invalid("stage");
  const processed = optionalNonNegativeInteger(body.processed, "processed");
  const produced = optionalNonNegativeInteger(body.produced, "produced");
  const total = optionalNonNegativeInteger(body.total, "total");
  return { attemptId: body.attemptId, stage: body.stage, processed, produced, total };
}

export type CompleteBody = { attemptId: string; outcome: "COMPLETED" | "PARTIAL" };

export function parseCompleteBody(value: unknown): CompleteBody {
  const body = record(value, ["attemptId", "outcome"]);
  if (typeof body.attemptId !== "string") invalid("attemptId");
  if (body.outcome !== "COMPLETED" && body.outcome !== "PARTIAL") invalid("outcome");
  return { attemptId: body.attemptId, outcome: body.outcome };
}

export type FailBody = { attemptId: string; errorCode: string; retryable: boolean };

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

export function parseFailBody(value: unknown): FailBody {
  const body = record(value, ["attemptId", "errorCode", "retryable"]);
  if (typeof body.attemptId !== "string") invalid("attemptId");
  if (typeof body.errorCode !== "string" || !ERROR_CODE_PATTERN.test(body.errorCode))
    invalid("errorCode");
  if (typeof body.retryable !== "boolean") invalid("retryable");
  return {
    attemptId: body.attemptId,
    errorCode: body.errorCode,
    retryable: body.retryable,
  };
}

function optionalNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(field);
  return value as number;
}

function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("body");
  const body = value as Record<string, unknown>;
  const disallowed = Object.keys(body).filter((key) => !allowed.includes(key));
  if (disallowed.length > 0) invalid(disallowed[0]!);
  return body;
}

function invalid(field: string): never {
  throw new AppError({
    code: "VALIDATION_EXECUTION_ATTEMPT_INVALID",
    message: "Request body is invalid.",
    statusCode: 400,
    details: { field },
  });
}
