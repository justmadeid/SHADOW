import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { isResourceId } from "@intelligence/contracts";

import { AppError } from "../../../../platform/errors/index.js";
import { etagForRevision, parseIfMatchRevision } from "../../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../../platform/http/idempotency.js";
import { NodeInstanceFacade } from "../../application/node-instance.facade.js";
import type { InputBinding } from "../../domain/input-binding.js";
import {
  parseCreateNodeInstanceBody,
  parseCreateWorkflowEdgeBody,
  parseInputBindingsBody,
  parseUpdateNodeInstanceBody,
} from "../../domain/node-instance-input.js";
import type { NodeInstance } from "../../domain/node-instance.js";
import type { WorkflowEdge } from "../../domain/workflow-edge.js";

@Controller("api/v1")
export class NodeInstanceController {
  constructor(
    @Inject(NodeInstanceFacade) private readonly nodeInstances: NodeInstanceFacade,
  ) {}

  @Post("investigations/:investigationId/nodes")
  async create(
    @Param("investigationId") investigationId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.nodeInstances.create(
      id(investigationId),
      parseCreateNodeInstanceBody(body),
      parseIdempotencyKey(key, { required: true })!,
    );
    response.status(201).setHeader("location", `/api/v1/nodes/${value.id}`);
    response.setHeader("etag", etagForRevision(value.revision));
    return serializeNodeInstance(value);
  }

  @Get("nodes/:nodeInstanceId")
  async get(
    @Param("nodeInstanceId") nodeInstanceId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.nodeInstances.get(id(nodeInstanceId));
    const bindings = await this.nodeInstances.listInputBindings(id(nodeInstanceId));
    response.setHeader("etag", etagForRevision(value.revision));
    return {
      ...serializeNodeInstance(value),
      inputBindings: bindings.map(serializeBinding),
    };
  }

  @Patch("nodes/:nodeInstanceId")
  async update(
    @Param("nodeInstanceId") nodeInstanceId: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.nodeInstances.updateConfiguration(
      id(nodeInstanceId),
      parseUpdateNodeInstanceBody(body),
      requireRevision(ifMatch),
    );
    response.setHeader("etag", etagForRevision(value.revision));
    return serializeNodeInstance(value);
  }

  @Delete("nodes/:nodeInstanceId")
  @HttpCode(204)
  async archive(
    @Param("nodeInstanceId") nodeInstanceId: string,
    @Headers("if-match") ifMatch: string | undefined,
  ) {
    await this.nodeInstances.archive(id(nodeInstanceId), requireRevision(ifMatch));
  }

  @Post("nodes/:nodeInstanceId/input-bindings")
  @HttpCode(200)
  async replaceInputBindings(
    @Param("nodeInstanceId") nodeInstanceId: string,
    @Body() body: unknown,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const value = await this.nodeInstances.replaceInputBindings(
      id(nodeInstanceId),
      parseInputBindingsBody(body),
      requireRevision(ifMatch),
    );
    const bindings = await this.nodeInstances.listInputBindings(id(nodeInstanceId));
    response.setHeader("etag", etagForRevision(value.revision));
    return {
      ...serializeNodeInstance(value),
      inputBindings: bindings.map(serializeBinding),
    };
  }

  @Post("investigations/:investigationId/workflow-edges")
  async createEdge(
    @Param("investigationId") investigationId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = parseCreateWorkflowEdgeBody(body);
    const value = await this.nodeInstances.createEdge(
      id(investigationId),
      id(parsed.fromNodeInstanceId),
      id(parsed.toNodeInstanceId),
    );
    response.status(201).setHeader("location", `/api/v1/workflow-edges/${value.id}`);
    return serializeEdge(value);
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
      message: "If-Match is required for NodeInstance mutations.",
      statusCode: 400,
    });
  return revision;
}

function serializeNodeInstance(value: NodeInstance) {
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    archivedAt: value.archivedAt?.toISOString() ?? null,
  };
}

function serializeBinding(value: InputBinding) {
  return { ...value };
}

function serializeEdge(value: WorkflowEdge) {
  return { ...value, createdAt: value.createdAt.toISOString() };
}
