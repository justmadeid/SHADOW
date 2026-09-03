import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";

import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision } from "../../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { assertUuid } from "../../../../platform/ids/uuid.js";
import { WorkspaceFacade } from "../../application/workspace.facade.js";
import type { CreateWorkspaceInput } from "../../domain/workspace.js";

@Controller("api/v1/workspaces")
export class WorkspaceController {
  constructor(@Inject(WorkspaceFacade) private readonly workspaces: WorkspaceFacade) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseCreateWorkspaceBody(body);
    const idempotencyKey = parseIdempotencyKey(idempotencyHeader, {
      required: true,
    });
    const workspace = await this.workspaces.create(input, idempotencyKey!);

    response.status(201);
    response.setHeader("location", `/api/v1/workspaces/${workspace.id}`);
    response.setHeader("etag", etagForRevision(workspace.revision));
    return serializeWorkspace(workspace);
  }

  @Get()
  async list() {
    return { items: (await this.workspaces.list()).map(serializeWorkspace) };
  }

  @Get(":workspaceId")
  async get(
    @Param("workspaceId") workspaceId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const workspace = await this.workspaces.get(parseWorkspaceId(workspaceId));
    response.setHeader("etag", etagForRevision(workspace.revision));
    return serializeWorkspace(workspace);
  }
}

function parseWorkspaceId(value: string): string {
  try {
    return assertUuid(value);
  } catch {
    throw new AppError({
      code: "VALIDATION_INVALID_RESOURCE_ID",
      message: "Workspace ID must be a valid UUID.",
      statusCode: 400,
    });
  }
}

function parseCreateWorkspaceBody(body: unknown): CreateWorkspaceInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalidBody();
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set(["name", "slug", "locale", "timeZone"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return invalidBody();
  }
  if (
    typeof record.name !== "string" ||
    typeof record.slug !== "string" ||
    typeof record.locale !== "string" ||
    typeof record.timeZone !== "string"
  ) {
    return invalidBody();
  }
  return {
    name: record.name,
    slug: record.slug,
    locale: record.locale,
    timeZone: record.timeZone,
  };
}

function invalidBody(): never {
  throw new AppError({
    code: "VALIDATION_WORKSPACE_INVALID",
    message: "Workspace request body is invalid.",
    statusCode: 400,
  });
}

function serializeWorkspace(workspace: Awaited<ReturnType<WorkspaceFacade["get"]>>) {
  return {
    ...workspace,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}
