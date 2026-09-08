import { Controller, Get, Inject, Param, Query } from "@nestjs/common";

import { AppError } from "../../../../platform/errors/index.js";
import { NodeDefinitionFacade } from "../../application/node-definition.facade.js";
import {
  NODE_DEFINITION_KEY_PATTERN,
  type NodeDefinition,
} from "../../domain/node-definition.js";

@Controller("api/v1")
export class NodeDefinitionController {
  constructor(
    @Inject(NodeDefinitionFacade)
    private readonly nodeDefinitions: NodeDefinitionFacade,
  ) {}

  @Get("node-definitions")
  async list(@Query() query: Record<string, unknown>) {
    if (
      Object.keys(query).some((key) => !["cursor", "limit"].includes(key)) ||
      (query.cursor !== undefined && typeof query.cursor !== "string") ||
      (query.limit !== undefined &&
        (typeof query.limit !== "string" || !/^[1-9][0-9]{0,2}$/.test(query.limit)))
    )
      throw new AppError({
        code: "VALIDATION_NODE_DEFINITION_QUERY_INVALID",
        message: "NodeDefinition query is invalid.",
        statusCode: 400,
      });
    const page = await this.nodeDefinitions.list(
      query.limit === undefined ? 50 : Number(query.limit),
      query.cursor as string | undefined,
    );
    return { items: page.items.map(serialize), page: page.page };
  }

  @Get("node-definitions/:key/versions/:version")
  async get(@Param("key") key: string, @Param("version") version: string) {
    if (!NODE_DEFINITION_KEY_PATTERN.test(key))
      throw new AppError({
        code: "VALIDATION_INVALID_NODE_DEFINITION_KEY",
        message: "NodeDefinition key is invalid.",
        statusCode: 400,
      });
    if (!/^[1-9][0-9]*$/.test(version))
      throw new AppError({
        code: "VALIDATION_INVALID_NODE_DEFINITION_VERSION",
        message: "NodeDefinition version is invalid.",
        statusCode: 400,
      });
    return serialize(await this.nodeDefinitions.get(key, Number(version)));
  }
}

function serialize(value: NodeDefinition) {
  return { ...value, createdAt: value.createdAt.toISOString() };
}
