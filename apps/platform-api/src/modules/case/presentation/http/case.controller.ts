import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision, parseIfMatchRevision } from "../../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { assertUuid } from "../../../../platform/ids/uuid.js";
import { CaseFacade } from "../../application/case.facade.js";
import {
  DATA_CLASSIFICATIONS,
  type DataClassification,
  type CreateCaseInput,
  type UpdateCaseInput,
} from "../../domain/case.js";

@Controller("api/v1/cases")
export class CaseController {
  constructor(@Inject(CaseFacade) private readonly cases: CaseFacade) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseCreateCaseBody(body);
    const idempotencyKey = parseIdempotencyKey(idempotencyHeader, { required: true });
    const created = await this.cases.create(input, idempotencyKey!);

    response.status(201);
    response.setHeader("location", `/api/v1/cases/${created.id}`);
    setCaseEtag(response, created.revision);
    return serializeCase(created);
  }

  @Get()
  async list(@Query("workspaceId") workspaceId: string | undefined) {
    const parsedWorkspaceId = parseResourceId(workspaceId, "Workspace");
    return { items: (await this.cases.list(parsedWorkspaceId)).map(serializeCase) };
  }

  @Get(":caseId")
  async get(
    @Param("caseId") caseId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const found = await this.cases.get(parseResourceId(caseId, "Case"));
    setCaseEtag(response, found.revision);
    return serializeCase(found);
  }

  @Patch(":caseId")
  async update(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const updated = await this.cases.update(
      parseResourceId(caseId, "Case"),
      parseUpdateCaseBody(body),
      requireExpectedRevision(ifMatch),
    );
    setCaseEtag(response, updated.revision);
    return serializeCase(updated);
  }

  @Post(":caseId/actions/close")
  @HttpCode(200)
  close(
    @Param("caseId") caseId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.runAction(caseId, "CLOSE", ifMatch, response);
  }

  @Post(":caseId/actions/reopen")
  @HttpCode(200)
  reopen(
    @Param("caseId") caseId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.runAction(caseId, "REOPEN", ifMatch, response);
  }

  @Post(":caseId/actions/archive")
  @HttpCode(200)
  archive(
    @Param("caseId") caseId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.runAction(caseId, "ARCHIVE", ifMatch, response);
  }

  private async runAction(
    caseId: string,
    action: "CLOSE" | "REOPEN" | "ARCHIVE",
    ifMatch: string | undefined,
    response: Response,
  ) {
    const updated = await this.cases.transition(
      parseResourceId(caseId, "Case"),
      action,
      requireExpectedRevision(ifMatch),
    );
    setCaseEtag(response, updated.revision);
    return serializeCase(updated);
  }
}

function parseCreateCaseBody(body: unknown): CreateCaseInput {
  const record = strictRecord(body, [
    "workspaceId",
    "title",
    "description",
    "classification",
  ]);
  if (
    typeof record.workspaceId !== "string" ||
    typeof record.title !== "string" ||
    !isOptionalNullableString(record.description) ||
    !isDataClassification(record.classification)
  ) {
    return invalidBody();
  }

  return {
    workspaceId: parseResourceId(record.workspaceId, "Workspace"),
    title: record.title,
    ...(record.description === undefined ? {} : { description: record.description }),
    classification: record.classification,
  };
}

function parseUpdateCaseBody(body: unknown): UpdateCaseInput {
  const record = strictRecord(body, ["title", "description", "classification"]);
  if (
    (record.title !== undefined && typeof record.title !== "string") ||
    !isOptionalNullableString(record.description) ||
    (record.classification !== undefined && !isDataClassification(record.classification))
  ) {
    return invalidBody();
  }

  return {
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.classification === undefined
      ? {}
      : { classification: record.classification }),
  };
}

function strictRecord(body: unknown, allowedFields: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalidBody();
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set(allowedFields);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return invalidBody();
  }
  return record;
}

function parseResourceId(value: string | undefined, label: string): string {
  if (!value) {
    throw new AppError({
      code: "VALIDATION_INVALID_RESOURCE_ID",
      message: `${label} ID must be provided as a valid UUID.`,
      statusCode: 400,
    });
  }

  try {
    return assertUuid(value);
  } catch {
    throw new AppError({
      code: "VALIDATION_INVALID_RESOURCE_ID",
      message: `${label} ID must be provided as a valid UUID.`,
      statusCode: 400,
    });
  }
}

function requireExpectedRevision(value: string | undefined): number {
  const revision = parseIfMatchRevision(value);
  if (revision === undefined) {
    throw new AppError({
      code: "VALIDATION_IF_MATCH_REQUIRED",
      message: "If-Match is required for Case mutations.",
      statusCode: 400,
    });
  }
  return revision;
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isDataClassification(value: unknown): value is DataClassification {
  return (
    typeof value === "string" &&
    DATA_CLASSIFICATIONS.includes(value as DataClassification)
  );
}

function invalidBody(): never {
  throw new AppError({
    code: "VALIDATION_CASE_INVALID",
    message: "Case request body is invalid.",
    statusCode: 400,
  });
}

function setCaseEtag(response: Response, revision: number): void {
  response.setHeader("etag", etagForRevision(revision));
}

function serializeCase(value: Awaited<ReturnType<CaseFacade["get"]>>) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    closedAt: value.closedAt?.toISOString() ?? null,
    archivedAt: value.archivedAt?.toISOString() ?? null,
  };
}
