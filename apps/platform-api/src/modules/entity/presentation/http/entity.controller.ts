import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision, parseIfMatchRevision } from "../../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { EntityFacade } from "../../application/entity.facade.js";
import {
  parseCreateEntity,
  parseMergeEntity,
  parseReverseEntityMerge,
  parseUpdateEntity,
} from "../../domain/entity-input.js";

@Controller("api/v1")
export class EntityController {
  constructor(@Inject(EntityFacade) private readonly entities: EntityFacade) {}

  @Post("workspaces/:workspaceId/entities")
  async create(
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.entities.create(
      id(workspaceId),
      parseCreateEntity(body),
      parseIdempotencyKey(key, { required: true })!,
    );
    response.status(201).setHeader("location", `/api/v1/entities/${value.id}`);
    response.setHeader("etag", etagForRevision(value.revision));
    return value;
  }

  @Get("workspaces/:workspaceId/entities")
  list(
    @Param("workspaceId") workspaceId: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (
      Object.keys(query).some((key) => !["cursor", "limit"].includes(key)) ||
      (query.cursor !== undefined && typeof query.cursor !== "string") ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(query.limit)))
    )
      throw new AppError({
        code: "VALIDATION_ENTITY_QUERY_INVALID",
        message: "Entity query is invalid.",
        statusCode: 400,
      });
    return this.entities.list(
      id(workspaceId),
      query.limit === undefined ? 50 : Number(query.limit),
      query.cursor as string | undefined,
    );
  }

  @Get("entities/:entityId")
  async get(
    @Param("entityId") entityId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.entities.get(id(entityId));
    response.setHeader("etag", etagForRevision(value.revision));
    return value;
  }

  @Patch("entities/:entityId")
  async update(
    @Param("entityId") entityId: string,
    @Body() body: unknown,
    @Headers("if-match") header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const revision = parseIfMatchRevision(header);
    if (revision === undefined)
      throw new AppError({
        code: "VALIDATION_IF_MATCH_REQUIRED",
        message: "If-Match is required for Entity mutations.",
        statusCode: 400,
      });
    const value = await this.entities.update(
      id(entityId),
      parseUpdateEntity(body),
      revision,
    );
    response.setHeader("etag", etagForRevision(value.revision));
    return value;
  }

  @Post("entities/:survivorEntityId/actions/merge")
  async merge(
    @Param("survivorEntityId") survivorEntityId: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("x-audit-operation-id") operationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const revision = parseIfMatchRevision(ifMatch);
    if (revision === undefined)
      throw new AppError({
        code: "VALIDATION_IF_MATCH_REQUIRED",
        message: "If-Match is required for the survivor Entity.",
        statusCode: 400,
      });
    if (!operationId)
      throw new AppError({
        code: "VALIDATION_AUDIT_OPERATION_ID_REQUIRED",
        message: "X-Audit-Operation-Id is required for Entity merge.",
        statusCode: 400,
      });
    const value = await this.entities.merge(
      id(survivorEntityId),
      parseMergeEntity(body),
      revision,
      parseIdempotencyKey(key, { required: true })!,
      id(operationId),
    );
    response.status(201).setHeader("etag", etagForRevision(value.survivorRevision));
    return value;
  }

  @Post("entity-merges/:mergeId/actions/reverse")
  async reverseMerge(
    @Param("mergeId") mergeId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Headers("x-audit-operation-id") operationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!operationId)
      throw new AppError({
        code: "VALIDATION_AUDIT_OPERATION_ID_REQUIRED",
        message: "X-Audit-Operation-Id is required for Entity merge reversal.",
        statusCode: 400,
      });
    const value = await this.entities.reverseMerge(
      id(mergeId),
      parseReverseEntityMerge(body),
      parseIdempotencyKey(key, { required: true })!,
      id(operationId),
    );
    response.status(201);
    return value;
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
