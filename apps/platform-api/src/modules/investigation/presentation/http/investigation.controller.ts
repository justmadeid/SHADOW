import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision, parseIfMatchRevision } from "../../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { assertUuid } from "../../../../platform/ids/uuid.js";
import { InvestigationFacade } from "../../application/investigation.facade.js";
import {
  INVESTIGATION_STATUSES,
  type CreateInvestigationInput,
  type InvestigationStatus,
  type UpdateInvestigationInput,
} from "../../domain/investigation.js";

@Controller("api/v1")
export class InvestigationController {
  constructor(
    @Inject(InvestigationFacade)
    private readonly investigations: InvestigationFacade,
  ) {}

  @Post("cases/:caseId/investigations")
  async create(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const created = await this.investigations.create(
      parseId(caseId, "Case"),
      parseCreateBody(body),
      parseIdempotencyKey(idempotencyHeader, { required: true })!,
    );
    response.status(201);
    response.setHeader("location", `/api/v1/investigations/${created.id}`);
    setEtag(response, created.revision);
    return serialize(created);
  }

  @Get("cases/:caseId/investigations")
  async list(@Param("caseId") caseId: string) {
    return {
      items: (await this.investigations.list(parseId(caseId, "Case"))).map(serialize),
    };
  }

  @Get("investigations/:investigationId")
  async get(
    @Param("investigationId") investigationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const found = await this.investigations.get(
      parseId(investigationId, "Investigation"),
    );
    setEtag(response, found.revision);
    return serialize(found);
  }

  @Patch("investigations/:investigationId")
  async update(
    @Param("investigationId") investigationId: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const updated = await this.investigations.update(
      parseId(investigationId, "Investigation"),
      parseUpdateBody(body),
      requireRevision(ifMatch),
    );
    setEtag(response, updated.revision);
    return serialize(updated);
  }
}

function parseCreateBody(body: unknown): CreateInvestigationInput {
  const record = strictRecord(body, ["title", "objective"]);
  if (typeof record.title !== "string" || typeof record.objective !== "string") {
    return invalidBody();
  }
  return { title: record.title, objective: record.objective };
}

function parseUpdateBody(body: unknown): UpdateInvestigationInput {
  const record = strictRecord(body, ["title", "objective", "status"]);
  if (
    (record.title !== undefined && typeof record.title !== "string") ||
    (record.objective !== undefined && typeof record.objective !== "string") ||
    (record.status !== undefined && !isStatus(record.status))
  ) {
    return invalidBody();
  }
  return {
    ...(record.title === undefined ? {} : { title: record.title }),
    ...(record.objective === undefined ? {} : { objective: record.objective }),
    ...(record.status === undefined ? {} : { status: record.status }),
  };
}

function strictRecord(body: unknown, allowedFields: string[]): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidBody();
  const record = body as Record<string, unknown>;
  const allowed = new Set(allowedFields);
  if (Object.keys(record).some((key) => !allowed.has(key))) return invalidBody();
  return record;
}

function isStatus(value: unknown): value is InvestigationStatus {
  return (
    typeof value === "string" &&
    INVESTIGATION_STATUSES.includes(value as InvestigationStatus)
  );
}

function parseId(value: string, label: string): string {
  try {
    return assertUuid(value);
  } catch {
    throw new AppError({
      code: "VALIDATION_INVALID_RESOURCE_ID",
      message: `${label} ID must be a valid UUID.`,
      statusCode: 400,
    });
  }
}

function requireRevision(value: string | undefined): number {
  const revision = parseIfMatchRevision(value);
  if (revision === undefined) {
    throw new AppError({
      code: "VALIDATION_IF_MATCH_REQUIRED",
      message: "If-Match is required for Investigation mutations.",
      statusCode: 400,
    });
  }
  return revision;
}

function invalidBody(): never {
  throw new AppError({
    code: "VALIDATION_INVESTIGATION_INVALID",
    message: "Investigation request body is invalid.",
    statusCode: 400,
  });
}

function setEtag(response: Response, revision: number): void {
  response.setHeader("etag", etagForRevision(revision));
}

function serialize(value: Awaited<ReturnType<InvestigationFacade["get"]>>) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    completedAt: value.completedAt?.toISOString() ?? null,
    archivedAt: value.archivedAt?.toISOString() ?? null,
  };
}
