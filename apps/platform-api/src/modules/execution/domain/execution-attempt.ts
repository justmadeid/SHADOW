import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";

export const ATTEMPT_STATUSES = [
  "LEASED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "LOST",
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

const ACTIVE_STATUSES: readonly AttemptStatus[] = ["LEASED", "RUNNING"];

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const STAGE_PATTERN_MAX_LENGTH = 64;

export type AttemptProgress = Readonly<{
  stage: string;
  processed: number | null;
  produced: number | null;
  total: number | null;
}>;

export type ExecutionAttempt = Readonly<{
  id: string;
  runId: string;
  workspaceId: string;
  caseId: string;
  attemptNumber: number;
  workerIdentity: string;
  leaseOwner: string;
  leaseDurationSeconds: number;
  leasedUntil: Date;
  status: AttemptStatus;
  errorCode: string | null;
  retryable: boolean | null;
  lastProgress: AttemptProgress | null;
  startedAt: Date;
  heartbeatAt: Date;
  completedAt: Date | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export function createExecutionAttempt(
  input: {
    id: string;
    runId: string;
    workspaceId: string;
    caseId: string;
    attemptNumber: number;
    workerIdentity: string;
    leaseOwner: string;
    leaseDurationSeconds: number;
  },
  now: Date,
): ExecutionAttempt {
  for (const value of [input.id, input.runId, input.workspaceId, input.caseId])
    if (!isResourceId(value)) invalid("id");
  if (!Number.isSafeInteger(input.attemptNumber) || input.attemptNumber < 1)
    invalid("attemptNumber");
  if (typeof input.workerIdentity !== "string" || input.workerIdentity.trim().length < 1)
    invalid("workerIdentity");
  assertLeaseOwner(input.leaseOwner);
  assertLeaseDurationSeconds(input.leaseDurationSeconds);

  return Object.freeze({
    id: input.id,
    runId: input.runId,
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    attemptNumber: input.attemptNumber,
    workerIdentity: input.workerIdentity,
    leaseOwner: input.leaseOwner,
    leaseDurationSeconds: input.leaseDurationSeconds,
    leasedUntil: new Date(now.getTime() + input.leaseDurationSeconds * 1000),
    status: "LEASED",
    errorCode: null,
    retryable: null,
    lastProgress: null,
    startedAt: now,
    heartbeatAt: now,
    completedAt: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
}

export function assertLeaseOwner(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200)
    invalid("leaseOwner");
}

export function assertLeaseDurationSeconds(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 300)
    invalid("leaseDurationSeconds");
}

export function assertErrorCode(value: unknown): asserts value is string {
  if (typeof value !== "string" || !ERROR_CODE_PATTERN.test(value)) invalid("errorCode");
}

export function assertProgressStage(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > STAGE_PATTERN_MAX_LENGTH
  )
    invalid("stage");
}

/** True iff the attempt is the currently live one: LEASED/RUNNING and its lease has not expired. */
export function isAttemptActive(attempt: ExecutionAttempt, now: Date): boolean {
  return (
    ACTIVE_STATUSES.includes(attempt.status) &&
    attempt.leasedUntil.getTime() > now.getTime()
  );
}

/** True iff the attempt's lease has expired while it was still LEASED/RUNNING (lazy-expiry candidate). */
export function isAttemptLeaseExpired(attempt: ExecutionAttempt, now: Date): boolean {
  return (
    ACTIVE_STATUSES.includes(attempt.status) &&
    attempt.leasedUntil.getTime() <= now.getTime()
  );
}

export function assertAttemptExpired(attempt: ExecutionAttempt, now: Date): void {
  if (!isAttemptLeaseExpired(attempt, now))
    throw new AppError({
      code: "EXECUTION_ATTEMPT_NOT_EXPIRED",
      message: "ExecutionAttempt lease has not expired.",
      statusCode: 409,
    });
}

/** Lazy-expiry detection: LEASED/RUNNING with an expired lease -> LOST. */
export function markAttemptLost(attempt: ExecutionAttempt, now: Date): ExecutionAttempt {
  assertAttemptExpired(attempt, now);
  return Object.freeze({
    ...attempt,
    status: "LOST",
    completedAt: attempt.completedAt ?? now,
    revision: attempt.revision + 1,
    updatedAt: now,
  });
}

export function assertAttemptActive(attempt: ExecutionAttempt, now: Date): void {
  if (!isAttemptActive(attempt, now))
    throw new AppError({
      code: "RUN_ATTEMPT_NOT_ACTIVE",
      message: "ExecutionAttempt is not the Run's current active attempt.",
      statusCode: 409,
    });
}

/**
 * Extends the lease (heartbeat), flips LEASED -> RUNNING on first call, and
 * records the latest factual progress. `total` is never used for any derived
 * percentage math — it stays a raw, possibly-null figure (Execution Gate:
 * "progress never fakes a percentage when total is unknown").
 */
export function recordAttemptProgress(
  attempt: ExecutionAttempt,
  progress: {
    stage: string;
    processed: number | null;
    produced: number | null;
    total: number | null;
  },
  now: Date,
): ExecutionAttempt {
  assertAttemptActive(attempt, now);
  assertProgressStage(progress.stage);
  for (const value of [progress.processed, progress.produced, progress.total])
    if (value !== null && (!Number.isSafeInteger(value) || value < 0))
      invalid("progress");

  return Object.freeze({
    ...attempt,
    status: "RUNNING",
    leasedUntil: new Date(now.getTime() + attempt.leaseDurationSeconds * 1000),
    heartbeatAt: now,
    lastProgress: Object.freeze({ ...progress }),
    revision: attempt.revision + 1,
    updatedAt: now,
  });
}

export function succeedAttempt(attempt: ExecutionAttempt, now: Date): ExecutionAttempt {
  return Object.freeze({
    ...attempt,
    status: "SUCCEEDED",
    completedAt: attempt.completedAt ?? now,
    revision: attempt.revision + 1,
    updatedAt: now,
  });
}

export function failAttempt(
  attempt: ExecutionAttempt,
  errorCode: string,
  retryable: boolean,
  now: Date,
): ExecutionAttempt {
  assertErrorCode(errorCode);
  if (typeof retryable !== "boolean") invalid("retryable");
  return Object.freeze({
    ...attempt,
    status: "FAILED",
    errorCode,
    retryable,
    completedAt: attempt.completedAt ?? now,
    revision: attempt.revision + 1,
    updatedAt: now,
  });
}

function invalid(field: string): never {
  throw new AppError({
    code: "VALIDATION_EXECUTION_ATTEMPT_INVALID",
    message: "ExecutionAttempt input is invalid.",
    statusCode: 400,
    details: { field },
  });
}
