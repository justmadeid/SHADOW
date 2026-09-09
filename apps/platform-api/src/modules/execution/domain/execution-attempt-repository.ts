import type { ExecutionAttempt } from "./execution-attempt.js";
import type { Run, RunTerminalOutcome } from "./run.js";

export const EXECUTION_ATTEMPT_REPOSITORY = Symbol("EXECUTION_ATTEMPT_REPOSITORY");

export type CreateAttemptCommand = {
  runId: string;
  workerIdentity: string;
  leaseOwner: string;
  leaseDurationSeconds: number;
  idempotencyKey: string;
  requestHash: string;
};

export type CreateAttemptResult = {
  attempt: ExecutionAttempt;
  run: Run;
  replayed: boolean;
};

export type RecordProgressCommand = {
  runId: string;
  attemptId: string;
  stage: string;
  processed: number | null;
  produced: number | null;
  total: number | null;
};

export type CompleteAttemptCommand = {
  runId: string;
  attemptId: string;
  outcome: Extract<RunTerminalOutcome, "COMPLETED" | "PARTIAL">;
};

export type CompleteAttemptResult = {
  run: Run;
  attempt: ExecutionAttempt;
  replayed: boolean;
};

export type FailAttemptCommand = {
  runId: string;
  attemptId: string;
  errorCode: string;
  retryable: boolean;
};

export type FailAttemptResult = {
  run: Run;
  attempt: ExecutionAttempt;
};

/**
 * Owns both the `execution_attempts` table and the ExecutionAttempt-driven
 * transitions of the `runs` table (Run != ExecutionAttempt as separate
 * aggregates, but both tables are owned by this same `execution` module, so a
 * single repository coordinating one atomic transaction across them is not a
 * cross-module boundary violation). Run's own public HTTP surface
 * (create/get/list/cancel/retry via RunRepository) is untouched by this port.
 */
export interface ExecutionAttemptRepository {
  /**
   * Idempotent on (workerIdentity, idempotencyKey). Applies lazy lease-expiry
   * detection (marks a stale LEASED/RUNNING attempt LOST before proceeding),
   * rejects a still-live active attempt (RUN_ATTEMPT_ALREADY_ACTIVE) and a
   * terminal Run (RUN_NOT_ATTEMPTABLE), computes attemptNumber server-side,
   * and transitions the Run QUEUED -> RUNNING on the first attempt only.
   */
  create(command: CreateAttemptCommand): Promise<CreateAttemptResult>;

  /** The Run's current active (LEASED/RUNNING, unexpired) attempt, if any. */
  findActive(runId: string, now: Date): Promise<ExecutionAttempt | undefined>;

  find(id: string): Promise<ExecutionAttempt | undefined>;

  findRun(runId: string): Promise<Run | undefined>;

  /** Heartbeat: extends the lease, flips LEASED -> RUNNING, records progress. */
  recordProgress(command: RecordProgressCommand, now: Date): Promise<ExecutionAttempt>;

  /**
   * Idempotent replay-safe: if the Run is already terminal with this exact
   * attempt+outcome, returns the current state instead of erroring.
   */
  complete(command: CompleteAttemptCommand, now: Date): Promise<CompleteAttemptResult>;

  /** retryable=true requeues the Run; retryable=false terminates it FAILED. */
  fail(command: FailAttemptCommand, now: Date): Promise<FailAttemptResult>;
}
