import { sql } from "drizzle-orm";
import { DatabaseContext } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import { decodeCursor, encodeCursor } from "../../../../platform/http/cursor.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import {
  parseNodeDefinitionInput,
  sameNodeDefinitionShape,
  type NodeDefinition,
  type NodeDefinitionInput,
  type NodeField,
} from "../../domain/node-definition.js";
import type {
  NodeDefinitionPage,
  NodeDefinitionRegistry,
} from "../../domain/node-definition-registry.js";

export class PostgresNodeDefinitionRepository implements NodeDefinitionRegistry {
  constructor(private readonly database: DatabaseContext) {}

  async register(input: NodeDefinitionInput): Promise<NodeDefinition> {
    const existing = await this.findByKeyVersion(input.key, input.version);
    if (existing) {
      const existingInput = toInput(existing);
      if (!sameNodeDefinitionShape(input, existingInput))
        throw new AppError({
          code: "CONFLICT_NODE_DEFINITION_KEY_VERSION_REUSED",
          message:
            "This NodeDefinition key+version was already registered with a different shape.",
          statusCode: 409,
        });
      return existing;
    }

    const id = newUuid();
    const now = new Date();
    await this.database.connection().execute(sql`
      INSERT INTO node_definitions
        (id, key, version, category, capability, inputs, outputs, config_schema,
         execution_policy, review_policy, required_permission, presentation, status, created_at)
      VALUES (
        ${id}, ${input.key}, ${input.version}, ${input.category}, ${input.capability},
        ${JSON.stringify(input.inputs)}::jsonb, ${JSON.stringify(input.outputs)}::jsonb,
        ${JSON.stringify(input.configSchema)}::jsonb,
        ${JSON.stringify(input.executionPolicy)}::jsonb, ${JSON.stringify(input.reviewPolicy)}::jsonb,
        ${input.requiredPermission}, ${JSON.stringify(input.presentation)}::jsonb, 'ACTIVE', ${now}
      )
    `);
    return {
      id,
      key: input.key,
      version: input.version,
      category: input.category,
      capability: input.capability,
      inputs: input.inputs,
      outputs: input.outputs,
      configSchema: input.configSchema,
      executionPolicy: input.executionPolicy,
      reviewPolicy: input.reviewPolicy,
      requiredPermission: input.requiredPermission,
      presentation: input.presentation,
      status: "ACTIVE",
      createdAt: now,
    };
  }

  async findByKeyVersion(
    key: string,
    version: number,
  ): Promise<NodeDefinition | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM node_definitions WHERE key = ${key} AND version = ${version} LIMIT 1
    `);
    const row = result.rows[0] as NodeDefinitionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async findLatestActiveByKey(key: string): Promise<NodeDefinition | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM node_definitions
      WHERE key = ${key} AND status = 'ACTIVE'
      ORDER BY version DESC LIMIT 1
    `);
    const row = result.rows[0] as NodeDefinitionRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async list(limit: number, cursor?: string): Promise<NodeDefinitionPage> {
    const bound = Math.max(1, Math.min(100, Math.floor(limit)));
    let afterKey = "";
    if (cursor !== undefined) {
      const payload = decodeCursor<unknown>(cursor);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("afterKey" in payload) ||
        typeof payload.afterKey !== "string"
      )
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "The NodeDefinition cursor is invalid.",
          statusCode: 400,
        });
      afterKey = payload.afterKey;
    }
    const result = await this.database.connection().execute(sql`
      SELECT * FROM (
        SELECT DISTINCT ON (key) *
        FROM node_definitions
        WHERE status = 'ACTIVE'
        ORDER BY key, version DESC
      ) latest
      WHERE key > ${afterKey}
      ORDER BY key
      LIMIT ${bound + 1}
    `);
    const rows = result.rows as NodeDefinitionRow[];
    const items = rows.slice(0, bound).map(mapRow);
    const hasMore = rows.length > bound;
    return {
      items,
      page: {
        hasMore,
        nextCursor: hasMore ? encodeCursor({ afterKey: items.at(-1)!.key }) : null,
      },
    };
  }
}

type NodeDefinitionRow = {
  id: string;
  key: string;
  version: number;
  category: NodeDefinition["category"];
  capability: string;
  inputs: NodeField[];
  outputs: NodeField[];
  config_schema: NodeField[];
  execution_policy: NodeDefinition["executionPolicy"];
  review_policy: NodeDefinition["reviewPolicy"];
  required_permission: NodeDefinition["requiredPermission"];
  presentation: NodeDefinition["presentation"];
  status: NodeDefinition["status"];
  created_at: Date | string;
};

function mapRow(row: NodeDefinitionRow): NodeDefinition {
  return Object.freeze({
    id: row.id,
    key: row.key,
    version: row.version,
    category: row.category,
    capability: row.capability,
    inputs: row.inputs,
    outputs: row.outputs,
    configSchema: row.config_schema,
    executionPolicy: row.execution_policy,
    reviewPolicy: row.review_policy,
    requiredPermission: row.required_permission,
    presentation: row.presentation,
    status: row.status,
    createdAt: new Date(row.created_at),
  });
}

function toInput(definition: NodeDefinition): NodeDefinitionInput {
  // Round-trips the persisted row through the same strict parser used for
  // registration so a stored row and a fresh request are compared identically.
  return parseNodeDefinitionInput({
    key: definition.key,
    version: definition.version,
    category: definition.category,
    capability: definition.capability,
    inputs: definition.inputs,
    outputs: definition.outputs,
    configSchema: definition.configSchema,
    executionPolicy: definition.executionPolicy,
    reviewPolicy: definition.reviewPolicy,
    requiredPermission: definition.requiredPermission,
    presentation: definition.presentation,
  });
}
