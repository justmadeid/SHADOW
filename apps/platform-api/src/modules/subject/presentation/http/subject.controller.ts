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
import { SubjectFacade } from "../../application/subject.facade.js";
import { parseCreateSubject, parseUpdateSubject } from "../../domain/subject-input.js";

@Controller("api/v1")
export class SubjectController {
  constructor(@Inject(SubjectFacade) private readonly subjects: SubjectFacade) {}

  @Post("cases/:caseId/subjects")
  async create(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.subjects.create(
      id(caseId),
      parseCreateSubject(body),
      parseIdempotencyKey(key, { required: true })!,
    );
    response.status(201).setHeader("location", `/api/v1/subjects/${value.id}`);
    response.setHeader("etag", etagForRevision(value.revision));
    return value;
  }
  @Get("cases/:caseId/subjects")
  list(@Param("caseId") caseId: string, @Query() query: Record<string, unknown>) {
    if (
      Object.keys(query).some((key) => !["cursor", "limit"].includes(key)) ||
      (query.cursor !== undefined && typeof query.cursor !== "string") ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(query.limit)))
    )
      throw new AppError({
        code: "VALIDATION_SUBJECT_QUERY_INVALID",
        message: "Subject query is invalid.",
        statusCode: 400,
      });
    return this.subjects.list(
      id(caseId),
      query.limit === undefined ? 50 : Number(query.limit),
      query.cursor as string | undefined,
    );
  }
  @Get("subjects/:subjectId")
  async get(
    @Param("subjectId") subjectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.subjects.get(id(subjectId));
    response.setHeader("etag", etagForRevision(value.revision));
    return value;
  }
  @Patch("subjects/:subjectId")
  async update(
    @Param("subjectId") subjectId: string,
    @Body() body: unknown,
    @Headers("if-match") header: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const revision = parseIfMatchRevision(header);
    if (revision === undefined)
      throw new AppError({
        code: "VALIDATION_IF_MATCH_REQUIRED",
        message: "If-Match is required for Subject mutations.",
        statusCode: 400,
      });
    const value = await this.subjects.update(
      id(subjectId),
      parseUpdateSubject(body),
      revision,
    );
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
