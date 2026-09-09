import { AppError } from "../../../platform/errors/index.js";
import type { NodeDefinition } from "../../workflow/index.js";
import type { ExecutionAttempt } from "./execution-attempt.js";
import type { Run, RunInputSnapshot } from "./run.js";

/**
 * Immutable, worker-facing plan (docs/knowledge/07_WORKFLOW_EXECUTION_CONNECTORS.md
 * §10). `connector` and `checkpoint` are always null in this slice: Source
 * Registry/connector resolution is P4-001+ and checkpoint/resume is P3-009 —
 * neither exists yet. The shape carries the fields now so a real future value
 * fits without a breaking change later.
 */
export type ExecutionPlan = Readonly<{
  runId: string;
  attempt: Readonly<{ id: string; attemptNumber: number; leaseOwner: string }>;
  capability: string;
  connector: Readonly<{ connectorId: string; version: number }> | null;
  input: RunInputSnapshot;
  limits: Readonly<{ timeoutSeconds: number }>;
  accessContext: Readonly<{
    workspaceId: string;
    caseId: string;
    investigationId: string;
    triggeredByUserId: string;
  }>;
  checkpoint: null;
}>;

export function composeExecutionPlan(
  run: Run,
  attempt: ExecutionAttempt,
  definition: NodeDefinition,
): ExecutionPlan {
  const plan: ExecutionPlan = Object.freeze({
    runId: run.id,
    attempt: Object.freeze({
      id: attempt.id,
      attemptNumber: attempt.attemptNumber,
      leaseOwner: attempt.leaseOwner,
    }),
    capability: definition.capability,
    // Always null in this slice: Source Registry (P4-001) does not exist yet.
    connector: null,
    input: run.inputSnapshot,
    limits: Object.freeze({ timeoutSeconds: definition.executionPolicy.timeoutSeconds }),
    accessContext: Object.freeze({
      workspaceId: run.workspaceId,
      caseId: run.caseId,
      investigationId: run.investigationId,
      triggeredByUserId: run.triggeredByUserId,
    }),
    // Always null in this slice: checkpoint/resume is P3-009.
    checkpoint: null,
  });
  assertExecutionPlanIsSecretFree(plan);
  return plan;
}

const FORBIDDEN_KEY_PATTERNS = [
  /secret/i,
  /api[_-]?key/i,
  /token/i,
  /credential/i,
  /password/i,
];

/**
 * Structural guard proving the literal P3-005 acceptance criterion: an
 * ExecutionPlan can never carry a plain secret, no matter what future field
 * is added, because nothing populating a forbidden-looking key can pass this
 * check. Mirrors outbox-payload-policy.ts's assertSafeOutboxPayload in spirit
 * (a recursive key walk), scoped to the ExecutionPlan shape specifically.
 */
export function assertExecutionPlanIsSecretFree(plan: ExecutionPlan): void {
  walk(plan as unknown, "$");
}

function walk(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key)))
      throw new AppError({
        code: "EXECUTION_PLAN_SENSITIVE_FIELD_FORBIDDEN",
        message: "ExecutionPlan must never carry a secret-shaped field.",
        statusCode: 500,
        details: { field: key, path },
      });
    walk(child, `${path}.${key}`);
  }
}
