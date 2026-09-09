import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { isResourceId } from "@intelligence/contracts";

import { DrizzleTransactionManager } from "@intelligence/database";
import { NodeDefinitionFacade } from "../../workflow/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import {
  EXECUTION_ATTEMPT_REPOSITORY,
  type ExecutionAttemptRepository,
} from "../domain/execution-attempt-repository.js";
import type { ExecutionAttempt } from "../domain/execution-attempt.js";
import {
  assertExecutionPlanIsSecretFree,
  composeExecutionPlan,
} from "../domain/execution-plan.js";
import type { ExecutionPlan } from "../domain/execution-plan.js";
import type { Run } from "../domain/run.js";

@Injectable()
export class ExecutionAttemptFacade {
  constructor(
    @Inject(EXECUTION_ATTEMPT_REPOSITORY)
    private readonly repository: ExecutionAttemptRepository,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
    @Inject(NodeDefinitionFacade) private readonly nodeDefinitions: NodeDefinitionFacade,
  ) {}

  async createAttempt(
    runId: string,
    input: { leaseOwner: string; leaseDurationSeconds: number },
    idempotencyKey: string,
  ): Promise<ExecutionAttempt> {
    const workerIdentity = this.requireServiceId();
    this.requireRunId(runId);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          runId,
          leaseOwner: input.leaseOwner,
          leaseDurationSeconds: input.leaseDurationSeconds,
        }),
      )
      .digest("hex");
    const result = await this.transactions.run(() =>
      this.repository.create({
        runId,
        workerIdentity,
        leaseOwner: input.leaseOwner,
        leaseDurationSeconds: input.leaseDurationSeconds,
        idempotencyKey,
        requestHash,
      }),
    );
    return result.attempt;
  }

  async recordProgress(
    runId: string,
    input: {
      attemptId: string;
      stage: string;
      processed: number | null;
      produced: number | null;
      total: number | null;
    },
  ): Promise<ExecutionAttempt> {
    this.requireServiceId();
    this.requireRunId(runId);
    const attemptId = this.requireAttemptId(input.attemptId);
    return this.transactions.run(() =>
      this.repository.recordProgress(
        {
          runId,
          attemptId,
          stage: input.stage,
          processed: input.processed,
          produced: input.produced,
          total: input.total,
        },
        new Date(),
      ),
    );
  }

  async complete(
    runId: string,
    input: { attemptId: string; outcome: "COMPLETED" | "PARTIAL" },
  ): Promise<Run> {
    this.requireServiceId();
    this.requireRunId(runId);
    const attemptId = this.requireAttemptId(input.attemptId);
    const result = await this.transactions.run(() =>
      this.repository.complete({ runId, attemptId, outcome: input.outcome }, new Date()),
    );
    return result.run;
  }

  async fail(
    runId: string,
    input: { attemptId: string; errorCode: string; retryable: boolean },
  ): Promise<Run> {
    this.requireServiceId();
    this.requireRunId(runId);
    const attemptId = this.requireAttemptId(input.attemptId);
    const result = await this.transactions.run(() =>
      this.repository.fail(
        { runId, attemptId, errorCode: input.errorCode, retryable: input.retryable },
        new Date(),
      ),
    );
    return result.run;
  }

  async buildExecutionPlan(runId: string): Promise<ExecutionPlan> {
    this.requireServiceId();
    this.requireRunId(runId);
    const run = await this.repository.findRun(runId);
    if (!run)
      throw new AppError({
        code: "RUN_NOT_FOUND",
        message: "Run was not found.",
        statusCode: 404,
      });

    const now = new Date();
    const attempt = await this.repository.findActive(runId, now);
    if (!attempt)
      throw new AppError({
        code: "RUN_EXECUTION_PLAN_NOT_AVAILABLE",
        message: "The Run has no currently active ExecutionAttempt to plan for.",
        statusCode: 409,
      });

    const definition = await this.nodeDefinitions.findByKeyVersion(
      run.nodeDefinitionKey,
      run.nodeDefinitionVersion,
    );
    if (!definition)
      // Data-integrity invariant: a Run always pins an existing NodeDefinition
      // key+version at creation time, and NodeDefinition rows are immutable
      // for their lifetime (P3-001), so this should never happen.
      throw new AppError({
        code: "EXECUTION_PLAN_NODE_DEFINITION_MISSING",
        message: "The Run's pinned NodeDefinition could not be resolved.",
        statusCode: 500,
      });

    const plan = composeExecutionPlan(run, attempt, definition);
    assertExecutionPlanIsSecretFree(plan);
    return plan;
  }

  private requireServiceId(): string {
    const principal = this.context.get().principal;
    if (!principal || principal.kind !== "SERVICE")
      throw new AppError({
        code: "AUTH_SERVICE_REQUIRED",
        message: "This operation requires an authenticated service principal.",
        statusCode: 403,
      });
    return principal.serviceId;
  }

  private requireRunId(value: string): string {
    if (!isResourceId(value))
      throw new AppError({
        code: "VALIDATION_INVALID_RESOURCE_ID",
        message: "Resource ID must be a valid UUID.",
        statusCode: 400,
      });
    return value;
  }

  private requireAttemptId(value: string): string {
    if (!isResourceId(value))
      throw new AppError({
        code: "VALIDATION_INVALID_RESOURCE_ID",
        message: "Resource ID must be a valid UUID.",
        statusCode: 400,
      });
    return value;
  }
}
