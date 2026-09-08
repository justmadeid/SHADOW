import { Controller, Get, Headers, Inject, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision } from "../../../../platform/http/etag.js";
import { ResolutionFacade } from "../../application/resolution.facade.js";

@Controller("api/v1")
export class ResolutionController {
  constructor(@Inject(ResolutionFacade) private readonly resolutions: ResolutionFacade) {}

  @Get("resolutions/:resolutionId")
  async getSession(
    @Param("resolutionId") resolutionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.resolutions.getSession(id(resolutionId));
    response.setHeader("etag", etagForRevision(value.revision));
    return value;
  }

  @Get("resolutions/:resolutionId/candidates")
  listCandidates(
    @Param("resolutionId") resolutionId: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (
      Object.keys(query).some((key) => !["cursor", "limit"].includes(key)) ||
      (query.cursor !== undefined && typeof query.cursor !== "string") ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(query.limit)))
    )
      throw new AppError({
        code: "VALIDATION_CANDIDATE_QUERY_INVALID",
        message: "Candidate query is invalid.",
        statusCode: 400,
      });
    return this.resolutions.listCandidates(
      id(resolutionId),
      query.limit === undefined ? 50 : Number(query.limit),
      query.cursor as string | undefined,
    );
  }

  @Get("resolutions/:resolutionId/matches")
  async listMatches(
    @Param("resolutionId") resolutionId: string,
    @Query() query: Record<string, unknown>,
    @Headers("x-reason-for-access") reasonForAccess: string | undefined,
    @Headers("x-audit-operation-id") operationId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      Object.keys(query).some((key) => !["cursor", "limit"].includes(key)) ||
      (query.cursor !== undefined && typeof query.cursor !== "string") ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(query.limit)))
    )
      throw new AppError({
        code: "VALIDATION_ENTITY_MATCH_QUERY_INVALID",
        message: "Entity match query is invalid.",
        statusCode: 400,
      });
    response.setHeader("cache-control", "private, no-store");
    return this.resolutions.listMatches(
      id(resolutionId),
      query.limit === undefined ? 50 : Number(query.limit),
      query.cursor as string | undefined,
      {
        ...(reasonForAccess === undefined ? {} : { reasonForAccess }),
        ...(operationId === undefined ? {} : { operationId }),
      },
    );
  }

  @Get("candidates/:candidateId")
  async getCandidate(
    @Param("candidateId") candidateId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.resolutions.getCandidate(id(candidateId));
    response.setHeader("etag", etagForRevision(value.revision));
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
