import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { isResourceId } from "@intelligence/contracts";

import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision, parseIfMatchRevision } from "../../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { RunFacade } from "../../application/run.facade.js";
import type { Run } from "../../domain/run.js";

@Controller("api/v1")
export class RunController {
  constructor(@Inject(RunFacade) private readonly runs: RunFacade) {}

  @Post("nodes/:nodeInstanceId/actions/run")
  async create(
    @Param("nodeInstanceId") nodeInstanceId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.runs.create(
      id(nodeInstanceId),
      parseIdempotencyKey(key, { required: true })!,
    );
    response.status(201).setHeader("location", `/api/v1/runs/${value.id}`);
    response.setHeader("etag", etagForRevision(value.revision));
    return serialize(value);
  }

  @Get("runs/:runId")
  async get(
    @Param("runId") runId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.runs.get(id(runId));
    response.setHeader("etag", etagForRevision(value.revision));
    return serialize(value);
  }

  @Get("cases/:caseId/runs")
  async list(@Param("caseId") caseId: string, @Query() query: Record<string, unknown>) {
    if (
      Object.keys(query).some((key) => !["cursor", "limit"].includes(key)) ||
      (query.cursor !== undefined && typeof query.cursor !== "string") ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(query.limit)))
    )
      throw new AppError({
        code: "VALIDATION_RUN_QUERY_INVALID",
        message: "Run query is invalid.",
        statusCode: 400,
      });
    const page = await this.runs.list(
      id(caseId),
      query.limit === undefined ? 50 : Number(query.limit),
      query.cursor as string | undefined,
    );
    return { items: page.items.map(serialize), page: page.page };
  }

  @Post("runs/:runId/actions/cancel")
  @HttpCode(200)
  async cancel(
    @Param("runId") runId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.runs.cancel(id(runId), requireRevision(ifMatch));
    response.setHeader("etag", etagForRevision(value.revision));
    return serialize(value);
  }

  @Post("runs/:runId/actions/retry")
  async retry(
    @Param("runId") runId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.runs.retry(
      id(runId),
      requireRevision(ifMatch),
      parseIdempotencyKey(key, { required: true })!,
    );
    response.status(201).setHeader("location", `/api/v1/runs/${value.id}`);
    response.setHeader("etag", etagForRevision(value.revision));
    return serialize(value);
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

function requireRevision(value: string | undefined): number {
  const revision = parseIfMatchRevision(value);
  if (revision === undefined)
    throw new AppError({
      code: "VALIDATION_IF_MATCH_REQUIRED",
      message: "If-Match is required for Run mutations.",
      statusCode: 400,
    });
  return revision;
}

function serialize(value: Run) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    startedAt: value.startedAt?.toISOString() ?? null,
    completedAt: value.completedAt?.toISOString() ?? null,
  };
}
