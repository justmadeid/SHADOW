import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/index.js";
import {
  createExecutionAttempt,
  failAttempt,
  isAttemptActive,
  isAttemptLeaseExpired,
  markAttemptLost,
  recordAttemptProgress,
  succeedAttempt,
} from "./execution-attempt.js";

const now = new Date("2026-09-08T00:00:00.000Z");
const base = {
  id: "0198c000-0000-7000-8000-000000000101",
  runId: "0198c000-0000-7000-8000-000000000001",
  workspaceId: "0198c000-0000-7000-8000-000000000002",
  caseId: "0198c000-0000-7000-8000-000000000003",
  attemptNumber: 1,
  workerIdentity: "connector-worker",
  leaseOwner: "worker-instance-a",
  leaseDurationSeconds: 30,
};

describe("createExecutionAttempt", () => {
  it("starts LEASED with leasedUntil = now + leaseDurationSeconds and revision 1", () => {
    const attempt = createExecutionAttempt(base, now);
    expect(attempt.status).toBe("LEASED");
    expect(attempt.leasedUntil).toEqual(new Date(now.getTime() + 30_000));
    expect(attempt.errorCode).toBeNull();
    expect(attempt.retryable).toBeNull();
    expect(attempt.lastProgress).toBeNull();
    expect(attempt.completedAt).toBeNull();
    expect(attempt.revision).toBe(1);
  });

  it("rejects an out-of-range leaseDurationSeconds", () => {
    expect(() =>
      createExecutionAttempt({ ...base, leaseDurationSeconds: 0 }, now),
    ).toThrow(AppError);
    expect(() =>
      createExecutionAttempt({ ...base, leaseDurationSeconds: 301 }, now),
    ).toThrow(AppError);
  });

  it("rejects an empty or over-long leaseOwner", () => {
    expect(() => createExecutionAttempt({ ...base, leaseOwner: "" }, now)).toThrow(
      AppError,
    );
    expect(() =>
      createExecutionAttempt({ ...base, leaseOwner: "x".repeat(201) }, now),
    ).toThrow(AppError);
  });
});

describe("isAttemptActive / isAttemptLeaseExpired", () => {
  it("is active while LEASED/RUNNING and unexpired", () => {
    const attempt = createExecutionAttempt(base, now);
    expect(isAttemptActive(attempt, now)).toBe(true);
    expect(isAttemptLeaseExpired(attempt, now)).toBe(false);
  });

  it("is expired once leasedUntil has passed", () => {
    const attempt = createExecutionAttempt(base, now);
    const later = new Date(now.getTime() + 31_000);
    expect(isAttemptActive(attempt, later)).toBe(false);
    expect(isAttemptLeaseExpired(attempt, later)).toBe(true);
  });

  it("a SUCCEEDED attempt is never active or lease-expired", () => {
    const attempt = succeedAttempt(createExecutionAttempt(base, now), now);
    const later = new Date(now.getTime() + 31_000);
    expect(isAttemptActive(attempt, later)).toBe(false);
    expect(isAttemptLeaseExpired(attempt, later)).toBe(false);
  });
});

describe("markAttemptLost", () => {
  it("transitions an expired LEASED/RUNNING attempt to LOST", () => {
    const attempt = createExecutionAttempt(base, now);
    const later = new Date(now.getTime() + 31_000);
    const lost = markAttemptLost(attempt, later);
    expect(lost.status).toBe("LOST");
    expect(lost.completedAt).toEqual(later);
    expect(lost.revision).toBe(2);
  });

  it("rejects marking a non-expired attempt LOST", () => {
    const attempt = createExecutionAttempt(base, now);
    expect(() => markAttemptLost(attempt, now)).toThrow(AppError);
  });
});

describe("recordAttemptProgress", () => {
  it("flips LEASED to RUNNING, extends the lease, and records progress without deriving a percentage", () => {
    const attempt = createExecutionAttempt(base, now);
    const later = new Date(now.getTime() + 10_000);
    const updated = recordAttemptProgress(
      attempt,
      { stage: "fetching", processed: 5, produced: 5, total: null },
      later,
    );
    expect(updated.status).toBe("RUNNING");
    expect(updated.leasedUntil).toEqual(new Date(later.getTime() + 30_000));
    expect(updated.heartbeatAt).toEqual(later);
    expect(updated.lastProgress).toEqual({
      stage: "fetching",
      processed: 5,
      produced: 5,
      total: null,
    });
    // total stays null; nothing derives a percentage from it.
    expect(updated.lastProgress?.total).toBeNull();
  });

  it("rejects progress once the attempt is no longer active", () => {
    const attempt = createExecutionAttempt(base, now);
    const later = new Date(now.getTime() + 31_000);
    expect(() =>
      recordAttemptProgress(
        attempt,
        { stage: "fetching", processed: 1, produced: 1, total: null },
        later,
      ),
    ).toThrow(AppError);
  });

  it("rejects a negative processed/produced/total value", () => {
    const attempt = createExecutionAttempt(base, now);
    expect(() =>
      recordAttemptProgress(
        attempt,
        { stage: "fetching", processed: -1, produced: 0, total: null },
        now,
      ),
    ).toThrow(AppError);
  });
});

describe("succeedAttempt / failAttempt", () => {
  it("succeedAttempt marks SUCCEEDED with completedAt set", () => {
    const attempt = createExecutionAttempt(base, now);
    const done = succeedAttempt(attempt, now);
    expect(done.status).toBe("SUCCEEDED");
    expect(done.completedAt).toEqual(now);
  });

  it("failAttempt marks FAILED with errorCode/retryable/completedAt set", () => {
    const attempt = createExecutionAttempt(base, now);
    const failed = failAttempt(attempt, "SOURCE_TIMEOUT", true, now);
    expect(failed.status).toBe("FAILED");
    expect(failed.errorCode).toBe("SOURCE_TIMEOUT");
    expect(failed.retryable).toBe(true);
    expect(failed.completedAt).toEqual(now);
  });

  it("rejects a malformed errorCode", () => {
    const attempt = createExecutionAttempt(base, now);
    expect(() => failAttempt(attempt, "not-a-code", true, now)).toThrow(AppError);
    expect(() => failAttempt(attempt, "AB", true, now)).toThrow(AppError);
  });
});
