import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { IdentifierFacade } from "../../application/identifier.facade.js";
import { parseCreateIdentifier } from "../../domain/identifier-input.js";

@Controller("api/v1")
export class IdentifierController {
  constructor(@Inject(IdentifierFacade) private readonly identifiers: IdentifierFacade) {}

  @Post("entities/:entityId/identifiers")
  async create(
    @Param("entityId") entityId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.identifiers.create(
      id(entityId),
      parseCreateIdentifier(body),
      parseIdempotencyKey(key, { required: true })!,
    );
    response
      .status(201)
      .setHeader("location", `/api/v1/identifiers/${value.id}`)
      .setHeader("cache-control", "private, no-store");
    return value;
  }

  @Get("entities/:entityId/identifiers")
  async list(
    @Param("entityId") entityId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("cache-control", "private, no-store");
    return this.identifiers.list(id(entityId));
  }

  @Get("identifiers/:identifierId")
  async get(
    @Param("identifierId") identifierId: string,
    @Headers("x-reason-for-access") reasonForAccess: string | undefined,
    @Headers("x-audit-operation-id") operationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("cache-control", "private, no-store");
    return this.identifiers.get(id(identifierId), {
      ...(reasonForAccess === undefined ? {} : { reasonForAccess }),
      ...(operationId === undefined ? {} : { operationId }),
    });
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
