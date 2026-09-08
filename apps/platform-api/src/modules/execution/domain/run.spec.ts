import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/index.js";
import { assertCancellable, assertRetryable, cancelRun, createRun } from "./run.js";

const now = new Date("2026-09-08T00:00:00.000Z");
const base = {
  id: "0198c000-0000-7000-8000-000000000001",
  workspaceId: "0198c000-0000-7000-8000-000000000002",
  caseId: "0198c000-0000-7000-8000-000000000003",
  investigationId: "0198c000-0000-7000-8000-000000000004",
  nodeInstanceId: "0198c000-0000-7000-8000-000000000005",
  nodeDefinitionKey: "person-lookup",
  nodeDefinitionVersion: 1,
  inputSnapshot: {
    configuration: { timeoutOverride: 5 },
    inputBindings: [
      {
        targetInput: "fullName",
        sourceExpression: "person.full_name",
        sourceType: "STRING" as const,
        sourceClassification: null,
      },
    ],
  },
  trigger: "MANUAL" as const,
  triggeredByUserId: "owner",
};

describe("createRun", () => {
  it("starts QUEUED with startedAt/completedAt null and parentRunId null", () => {
    const run = createRun(base, now);
    expect(run.status).toBe("QUEUED");
    expect(run.startedAt).toBeNull();
    expect(run.completedAt).toBeNull();
    expect(run.parentRunId).toBeNull();
    expect(run.retryOf).toBeNull();
    expect(run.revision).toBe(1);
  });

  it("freezes the inputSnapshot so later mutation cannot leak into history", () => {
    const run = createRun(base, now);
    expect(() => {
      (run.inputSnapshot.configuration as Record<string, unknown>).timeoutOverride = 999;
    }).toThrow();
  });

  it("records retryOf when creating a retry Run", () => {
    const run = createRun(
      { ...base, retryOf: "0198c000-0000-7000-8000-000000000009" },
      now,
    );
    expect(run.retryOf).toBe("0198c000-0000-7000-8000-000000000009");
  });
});

describe("assertCancellable / cancelRun", () => {
  it("allows cancellation from QUEUED and RUNNING", () => {
    const queued = createRun(base, now);
    expect(() => assertCancellable(queued)).not.toThrow();
    const running = { ...queued, status: "RUNNING" as const };
    expect(() => assertCancellable(running)).not.toThrow();
  });

  it("rejects cancellation from a terminal state", () => {
    const completed = { ...createRun(base, now), status: "COMPLETED" as const };
    expect(() => assertCancellable(completed)).toThrow(AppError);
  });

  it("cancelRun transitions status and increments revision", () => {
    const run = createRun(base, now);
    const cancelled = cancelRun(run, 1, now);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.revision).toBe(2);
  });

  it("cancelRun rejects a stale expected revision", () => {
    const run = createRun(base, now);
    expect(() => cancelRun(run, 99, now)).toThrow(AppError);
  });
});

describe("assertRetryable", () => {
  it("allows retry only from FAILED, PARTIAL or CANCELLED", () => {
    for (const status of ["FAILED", "PARTIAL", "CANCELLED"] as const) {
      expect(() => assertRetryable({ ...createRun(base, now), status })).not.toThrow();
    }
  });

  it("rejects retry from COMPLETED (retry is for terminal failure/cancellation, not success)", () => {
    const completed = { ...createRun(base, now), status: "COMPLETED" as const };
    expect(() => assertRetryable(completed)).toThrow(AppError);
  });

  it("rejects retry from QUEUED/RUNNING", () => {
    const queued = createRun(base, now);
    expect(() => assertRetryable(queued)).toThrow(AppError);
    expect(() => assertRetryable({ ...queued, status: "RUNNING" })).toThrow(AppError);
  });
});
