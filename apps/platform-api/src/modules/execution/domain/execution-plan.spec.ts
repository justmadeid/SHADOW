import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/index.js";
import { createExecutionAttempt } from "./execution-attempt.js";
import {
  assertExecutionPlanIsSecretFree,
  composeExecutionPlan,
} from "./execution-plan.js";
import { createRun } from "./run.js";

const now = new Date("2026-09-08T00:00:00.000Z");

const run = createRun(
  {
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
  },
  now,
);

const attempt = createExecutionAttempt(
  {
    id: "0198c000-0000-7000-8000-000000000101",
    runId: run.id,
    workspaceId: run.workspaceId,
    caseId: run.caseId,
    attemptNumber: 1,
    workerIdentity: "connector-worker",
    leaseOwner: "worker-instance-a",
    leaseDurationSeconds: 30,
  },
  now,
);

const definition = {
  id: "0198c000-0000-7000-8000-000000000201",
  key: "person-lookup",
  version: 1,
  category: "COLLECTION" as const,
  capability: "PERSON_LOOKUP",
  inputs: [],
  outputs: [],
  configSchema: [],
  executionPolicy: { timeoutSeconds: 60, retryable: true },
  reviewPolicy: { requiresHumanReview: false },
  requiredPermission: "WORKFLOW_CREATE" as const,
  presentation: { label: "Person Lookup", description: "..." },
  status: "ACTIVE" as const,
  createdAt: now,
};

describe("composeExecutionPlan", () => {
  it("builds a plan with connector and checkpoint always null in this slice", () => {
    const plan = composeExecutionPlan(run, attempt, definition);
    expect(plan.runId).toBe(run.id);
    expect(plan.attempt).toEqual({
      id: attempt.id,
      attemptNumber: 1,
      leaseOwner: "worker-instance-a",
    });
    expect(plan.capability).toBe("PERSON_LOOKUP");
    expect(plan.connector).toBeNull();
    expect(plan.checkpoint).toBeNull();
    expect(plan.limits).toEqual({ timeoutSeconds: 60 });
    expect(plan.input).toEqual(run.inputSnapshot);
    expect(plan.accessContext).toEqual({
      workspaceId: run.workspaceId,
      caseId: run.caseId,
      investigationId: run.investigationId,
      triggeredByUserId: run.triggeredByUserId,
    });
  });

  it(
    "is structurally secret-free: a recursive key walk finds no secret/apiKey/token/credential/password key anywhere " +
      "(the literal P3-005 acceptance criterion)",
    () => {
      const plan = composeExecutionPlan(run, attempt, definition);
      const serialized = JSON.stringify(plan);
      const forbidden = [
        "secret",
        "apikey",
        "api_key",
        "token",
        "credential",
        "password",
      ];

      // 1. Recursive key walk (structural — what assertExecutionPlanIsSecretFree checks).
      expect(() => assertExecutionPlanIsSecretFree(plan)).not.toThrow();

      // 2. Independent, test-owned corroboration: walk every key of the
      // serialized plan and assert none matches a forbidden substring.
      const keys = collectKeys(JSON.parse(serialized));
      for (const key of keys) {
        for (const bad of forbidden) {
          expect(key.toLowerCase().includes(bad)).toBe(false);
        }
      }
    },
  );

  it("assertExecutionPlanIsSecretFree rejects a plan carrying a forbidden-shaped key", () => {
    const tainted = {
      ...composeExecutionPlan(run, attempt, definition),
      apiKey: "leaked",
    };
    expect(() => assertExecutionPlanIsSecretFree(tainted as never)).toThrow(AppError);
  });
});

function collectKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  const record = value as Record<string, unknown>;
  return Object.keys(record).flatMap((key) => [key, ...collectKeys(record[key])]);
}
