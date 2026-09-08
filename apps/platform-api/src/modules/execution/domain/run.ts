import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import type { InputBinding } from "../../workflow/index.js";
import type { NodeInstanceConfiguration } from "../../workflow/index.js";

export const RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// Only MANUAL is implemented today; the array shape lets a future SCHEDULED
// trigger be added additively without a breaking type change.
export const RUN_TRIGGERS = ["MANUAL"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

const TERMINAL_CANCELLABLE_FROM: readonly RunStatus[] = ["QUEUED", "RUNNING"];
// COMPLETED is deliberately excluded: a completed Run has no business reason
// to retry. Only FAILED/PARTIAL/CANCELLED may be retried.
const RETRYABLE_FROM: readonly RunStatus[] = ["FAILED", "PARTIAL", "CANCELLED"];

/**
 * A frozen structural copy of the NodeInstance's configuration and
 * InputBindings at Run-creation time. This is NOT a live-resolved value
 * snapshot — resolving sourceExpression against live resources is deferred to
 * future Execution/ExecutionPlan work (P3-005+). Editing the NodeInstance
 * after a Run is created must never change this snapshot (P3-003 acceptance
 * criterion).
 */
export type RunInputSnapshot = Readonly<{
  configuration: NodeInstanceConfiguration;
  inputBindings: readonly InputBinding[];
}>;

export type Run = Readonly<{
  id: string;
  workspaceId: string;
  caseId: string;
  investigationId: string;
  nodeInstanceId: string;
  nodeDefinitionKey: string;
  nodeDefinitionVersion: number;
  inputSnapshot: RunInputSnapshot;
  status: RunStatus;
  trigger: RunTrigger;
  triggeredByUserId: string;
  parentRunId: string | null;
  retryOf: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}>;

export function createRun(
  input: {
    id: string;
    workspaceId: string;
    caseId: string;
    investigationId: string;
    nodeInstanceId: string;
    nodeDefinitionKey: string;
    nodeDefinitionVersion: number;
    inputSnapshot: RunInputSnapshot;
    trigger: RunTrigger;
    triggeredByUserId: string;
    retryOf?: string | null;
  },
  now: Date,
): Run {
  for (const id of [
    input.id,
    input.workspaceId,
    input.caseId,
    input.investigationId,
    input.nodeInstanceId,
  ])
    if (!isResourceId(id)) invalid("id");
  if (input.retryOf != null && !isResourceId(input.retryOf)) invalid("retryOf");
  if (!RUN_TRIGGERS.includes(input.trigger)) invalid("trigger");

  return Object.freeze({
    id: input.id,
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    investigationId: input.investigationId,
    nodeInstanceId: input.nodeInstanceId,
    nodeDefinitionKey: input.nodeDefinitionKey,
    nodeDefinitionVersion: input.nodeDefinitionVersion,
    inputSnapshot: freezeSnapshot(input.inputSnapshot),
    status: "QUEUED",
    trigger: input.trigger,
    triggeredByUserId: input.triggeredByUserId,
    // Groundwork for future P3-012 fan-out only; always null in this slice.
    parentRunId: null,
    retryOf: input.retryOf ?? null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  });
}

export function assertCancellable(current: Run): void {
  if (!TERMINAL_CANCELLABLE_FROM.includes(current.status))
    throw new AppError({
      code: "RUN_INVALID_STATUS_TRANSITION",
      message: "Only a QUEUED or RUNNING Run can be cancelled.",
      statusCode: 409,
      details: { currentStatus: current.status },
    });
}

export function cancelRun(current: Run, expectedRevision: number, now: Date): Run {
  assertExpectedRevision(expectedRevision, current.revision);
  assertCancellable(current);
  return Object.freeze({
    ...current,
    status: "CANCELLED",
    revision: current.revision + 1,
    updatedAt: now,
  });
}

export function assertRetryable(current: Run): void {
  if (!RETRYABLE_FROM.includes(current.status))
    throw new AppError({
      code: "RUN_INVALID_STATUS_TRANSITION",
      message: "Only a FAILED, PARTIAL or CANCELLED Run can be retried.",
      statusCode: 409,
      details: { currentStatus: current.status },
    });
}

function freezeSnapshot(snapshot: RunInputSnapshot): RunInputSnapshot {
  return Object.freeze({
    configuration: Object.freeze({ ...snapshot.configuration }),
    inputBindings: Object.freeze(
      snapshot.inputBindings.map((binding) => Object.freeze({ ...binding })),
    ),
  });
}

function invalid(field: string): never {
  throw new AppError({
    code: "VALIDATION_RUN_INVALID",
    message: "Run input is invalid.",
    statusCode: 400,
    details: { field },
  });
}
