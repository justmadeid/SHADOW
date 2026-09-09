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

export const RUN_TERMINAL_STATUSES: readonly RunStatus[] = [
  "COMPLETED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
];

/** ExecutionAttempt-driven terminal outcomes a Run can reach from RUNNING. */
export const RUN_TERMINAL_OUTCOMES = ["COMPLETED", "PARTIAL", "FAILED"] as const;
export type RunTerminalOutcome = (typeof RUN_TERMINAL_OUTCOMES)[number];

const STARTABLE_FROM: readonly RunStatus[] = ["QUEUED"];
const REQUEUEABLE_FROM: readonly RunStatus[] = ["RUNNING"];
const TERMINABLE_FROM: readonly RunStatus[] = ["RUNNING"];

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

export function isRunTerminal(status: RunStatus): boolean {
  return RUN_TERMINAL_STATUSES.includes(status);
}

/**
 * QUEUED -> RUNNING. Used only from the ExecutionAttempt code path (internal
 * worker API) when the first attempt for a Run is leased — never exposed as a
 * public HTTP mutation on Run's own controller. Sets startedAt the first time
 * a Run actually starts; a later attempt on the same Run (after a LOST
 * attempt) does not call this again because the Run is already RUNNING.
 */
export function assertStartable(current: Run): void {
  if (!STARTABLE_FROM.includes(current.status))
    throw new AppError({
      code: "RUN_INVALID_STATUS_TRANSITION",
      message: "Only a QUEUED Run can start.",
      statusCode: 409,
      details: { currentStatus: current.status },
    });
}

export function startRun(current: Run, now: Date): Run {
  assertStartable(current);
  return Object.freeze({
    ...current,
    status: "RUNNING",
    startedAt: current.startedAt ?? now,
    revision: current.revision + 1,
    updatedAt: now,
  });
}

/**
 * RUNNING -> QUEUED. Used when an ExecutionAttempt fails with retryable=true;
 * this is the literal mechanism behind the P3-004 acceptance criterion
 * ("infrastructure retry creates new Attempt on same Run").
 */
export function assertRequeueable(current: Run): void {
  if (!REQUEUEABLE_FROM.includes(current.status))
    throw new AppError({
      code: "RUN_INVALID_STATUS_TRANSITION",
      message: "Only a RUNNING Run can be requeued.",
      statusCode: 409,
      details: { currentStatus: current.status },
    });
}

export function requeueRun(current: Run, now: Date): Run {
  assertRequeueable(current);
  return Object.freeze({
    ...current,
    status: "QUEUED",
    revision: current.revision + 1,
    updatedAt: now,
  });
}

/**
 * RUNNING -> COMPLETED|PARTIAL|FAILED. Used when an ExecutionAttempt finishes
 * (complete action, or a non-retryable fail action). Sets completedAt.
 */
export function assertTerminable(current: Run): void {
  if (!TERMINABLE_FROM.includes(current.status))
    throw new AppError({
      code: "RUN_INVALID_STATUS_TRANSITION",
      message: "Only a RUNNING Run can be terminated by an ExecutionAttempt outcome.",
      statusCode: 409,
      details: { currentStatus: current.status },
    });
}

export function terminateRun(current: Run, outcome: RunTerminalOutcome, now: Date): Run {
  assertTerminable(current);
  return Object.freeze({
    ...current,
    status: outcome,
    completedAt: current.completedAt ?? now,
    revision: current.revision + 1,
    updatedAt: now,
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
