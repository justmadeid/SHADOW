import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { isResourceId } from "@intelligence/contracts";

import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision } from "../../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { ExecutionAttemptFacade } from "../../application/execution-attempt.facade.js";
import {
  parseCompleteBody,
  parseCreateAttemptBody,
  parseFailBody,
  parseProgressBody,
} from "../../domain/execution-attempt-input.js";
import type { ExecutionAttempt } from "../../domain/execution-attempt.js";
import type { ExecutionPlan } from "../../domain/execution-plan.js";
import type { Run } from "../../domain/run.js";

/**
 * Internal worker API, a different trust boundary from the public
 * `api/v1` Run controller: every method here requires a SERVICE principal
 * (enforced inside ExecutionAttemptFacade), never Case-membership permission
 * checks. See AGENTS.md "Public API /api/v1; internal worker API /internal/v1".
 */
@Controller("internal/v1")
export class ExecutionAttemptController {
  constructor(
    @Inject(ExecutionAttemptFacade) private readonly attempts: ExecutionAttemptFacade,
  ) {}

  @Post("runs/:runId/attempts")
  async createAttempt(
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.attempts.createAttempt(
      id(runId),
      parseCreateAttemptBody(body),
      parseIdempotencyKey(key, { required: true })!,
    );
    response.status(201).setHeader("etag", etagForRevision(value.revision));
    return serializeAttempt(value);
  }

  @Post("runs/:runId/progress")
  @HttpCode(200)
  async progress(
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.attempts.recordProgress(id(runId), parseProgressBody(body));
    response.setHeader("etag", etagForRevision(value.revision));
    return serializeAttempt(value);
  }

  @Post("runs/:runId/actions/complete")
  @HttpCode(200)
  async complete(
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.attempts.complete(id(runId), parseCompleteBody(body));
    response.setHeader("etag", etagForRevision(value.revision));
    return serializeRun(value);
  }

  @Post("runs/:runId/actions/fail")
  @HttpCode(200)
  async fail(
    @Param("runId") runId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.attempts.fail(id(runId), parseFailBody(body));
    response.setHeader("etag", etagForRevision(value.revision));
    return serializeRun(value);
  }

  @Get("runs/:runId/execution-plan")
  async executionPlan(@Param("runId") runId: string) {
    const value = await this.attempts.buildExecutionPlan(id(runId));
    return serializePlan(value);
  }
}

function id(value: string): string {
  if (!isResourceId(value))
    throw new AppError({
      code: "VALIDATION_INVALID_RESOURCE_ID",
      message: "Resource ID must be a valid UUID.",
      statusCode: 400,
    });
  return value;
}

function serializeAttempt(value: ExecutionAttempt) {
  return {
    ...value,
    leasedUntil: value.leasedUntil.toISOString(),
    startedAt: value.startedAt.toISOString(),
    heartbeatAt: value.heartbeatAt.toISOString(),
    completedAt: value.completedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function serializeRun(value: Run) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    startedAt: value.startedAt?.toISOString() ?? null,
    completedAt: value.completedAt?.toISOString() ?? null,
  };
}

function serializePlan(value: ExecutionPlan) {
  return { ...value };
}
