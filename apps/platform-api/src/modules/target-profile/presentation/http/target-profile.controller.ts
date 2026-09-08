import { Controller, Get, Inject, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import { TargetProfileFacade } from "../../application/target-profile.facade.js";

@Controller("api/v1/shadow")
export class TargetProfileController {
  constructor(
    @Inject(TargetProfileFacade) private readonly profiles: TargetProfileFacade,
  ) {}

  @Get("cases/:caseId/targets/:subjectId")
  async get(
    @Param("caseId") caseId: string,
    @Param("subjectId") subjectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.profiles.get(id(caseId), id(subjectId));
    response.setHeader("cache-control", "private, no-store");
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
