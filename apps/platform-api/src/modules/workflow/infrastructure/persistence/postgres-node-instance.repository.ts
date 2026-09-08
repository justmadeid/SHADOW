import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type { InputBinding } from "../../domain/input-binding.js";
import type {
  NodeInstance,
  NodeInstanceConfiguration,
  NodeInstanceStatus,
} from "../../domain/node-instance.js";
import type {
  ArchiveNodeInstanceCommand,
  CreateNodeInstanceCommand,
  CreateNodeInstanceResult,
  CreateWorkflowEdgeCommand,
  NodeInstanceRepository,
  ReplaceInputBindingsCommand,
  UpdateConfigurationCommand,
} from "../../domain/node-instance-repository.js";
import type { WorkflowEdge } from "../../domain/workflow-edge.js";

export class PostgresNodeInstanceRepository implements NodeInstanceRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async create(command: CreateNodeInstanceCommand): Promise<CreateNodeInstanceResult> {
    this.requireTransaction();
    const db = this.database.connection();
    const lock = `node-instance-create:${command.actorUserId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);

    const replay = await db.execute(sql`
      SELECT request_hash, node_instance_id FROM node_instance_idempotency
      WHERE user_id = ${command.actorUserId} AND idempotency_key = ${command.idempotencyKey}
    `);
    const replayRow = replay.rows[0] as
      { request_hash: string; node_instance_id: string } | undefined;
    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash)
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      const existing = await this.find(replayRow.node_instance_id);
      if (!existing) throw new Error("NodeInstance idempotency record is invalid.");
      return { nodeInstance: existing, replayed: true };
    }

    const id = newUuid();
    const now = new Date();
    const status: NodeInstanceStatus = command.ready ? "READY" : "DRAFT";
    await db.execute(sql`
      INSERT INTO node_instances
        (id, workspace_id, case_id, investigation_id, node_definition_key,
         node_definition_version, configuration, status, revision, created_at, updated_at, archived_at)
      VALUES (
        ${id}, ${command.workspaceId}, ${command.caseId}, ${command.investigationId},
        ${command.nodeDefinitionKey}, ${command.nodeDefinitionVersion},
        ${JSON.stringify(command.configuration)}::jsonb, ${status}, 1, ${now}, ${now}, NULL
      )
    `);
    await db.execute(sql`
      INSERT INTO node_instance_idempotency (user_id, idempotency_key, request_hash, node_instance_id)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${command.requestHash}, ${id})
    `);
    const nodeInstance: NodeInstance = Object.freeze({
      id,
      workspaceId: command.workspaceId,
      caseId: command.caseId,
      investigationId: command.investigationId,
      nodeDefinitionKey: command.nodeDefinitionKey,
      nodeDefinitionVersion: command.nodeDefinitionVersion,
      configuration: Object.freeze({ ...command.configuration }),
      status,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
    await this.record(nodeInstance, command.actorUserId, "NODE_INSTANCE_CREATED");
    return { nodeInstance, replayed: false };
  }

  async find(id: string): Promise<NodeInstance | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM node_instances WHERE id = ${id} LIMIT 1
    `);
    const row = result.rows[0] as NodeInstanceRow | undefined;
    return row ? mapRow(row) : undefined;
  }

  async listInputBindings(nodeInstanceId: string): Promise<InputBinding[]> {
    const result = await this.database.connection().execute(sql`
      SELECT target_input, source_expression, source_type, source_classification
      FROM node_instance_input_bindings
      WHERE node_instance_id = ${nodeInstanceId}
      ORDER BY target_input
    `);
    return (result.rows as InputBindingRow[]).map(mapBindingRow);
  }

  async replaceInputBindings(
    command: ReplaceInputBindingsCommand,
  ): Promise<NodeInstance> {
    this.requireTransaction();
    const db = this.database.connection();
    const status: NodeInstanceStatus = command.ready ? "READY" : "DRAFT";
    const result = await db.execute(sql`
      UPDATE node_instances
      SET status = ${status}, revision = revision + 1, updated_at = ${new Date()}
      WHERE id = ${command.nodeInstanceId} AND revision = ${command.expectedRevision}
        AND status <> 'ARCHIVED'
      RETURNING *
    `);
    const row = result.rows[0] as NodeInstanceRow | undefined;
    if (!row)
      return this.revisionMismatch(command.nodeInstanceId, command.expectedRevision);

    await db.execute(sql`
      DELETE FROM node_instance_input_bindings WHERE node_instance_id = ${command.nodeInstanceId}
    `);
    for (const binding of command.bindings) {
      await db.execute(sql`
        INSERT INTO node_instance_input_bindings
          (node_instance_id, target_input, source_expression, source_type, source_classification)
        VALUES (
          ${command.nodeInstanceId}, ${binding.targetInput}, ${binding.sourceExpression},
          ${binding.sourceType}, ${binding.sourceClassification}
        )
      `);
    }
    const nodeInstance = mapRow(row);
    await this.record(
      nodeInstance,
      command.actorUserId,
      "NODE_INSTANCE_INPUT_BINDINGS_REPLACED",
    );
    return nodeInstance;
  }

  async updateConfiguration(command: UpdateConfigurationCommand): Promise<NodeInstance> {
    this.requireTransaction();
    const result = await this.database.connection().execute(sql`
      UPDATE node_instances
      SET configuration = ${JSON.stringify(command.configuration)}::jsonb,
          revision = revision + 1, updated_at = ${new Date()}
      WHERE id = ${command.nodeInstanceId} AND revision = ${command.expectedRevision}
        AND status <> 'ARCHIVED'
      RETURNING *
    `);
    const row = result.rows[0] as NodeInstanceRow | undefined;
    if (!row)
      return this.revisionMismatch(command.nodeInstanceId, command.expectedRevision);
    const nodeInstance = mapRow(row);
    await this.record(nodeInstance, command.actorUserId, "NODE_INSTANCE_UPDATED");
    return nodeInstance;
  }

  async archive(command: ArchiveNodeInstanceCommand): Promise<NodeInstance> {
    this.requireTransaction();
    const now = new Date();
    const result = await this.database.connection().execute(sql`
      UPDATE node_instances
      SET status = 'ARCHIVED', archived_at = ${now}, revision = revision + 1, updated_at = ${now}
      WHERE id = ${command.nodeInstanceId} AND revision = ${command.expectedRevision}
        AND status <> 'ARCHIVED'
      RETURNING *
    `);
    const row = result.rows[0] as NodeInstanceRow | undefined;
    if (!row)
      return this.revisionMismatch(command.nodeInstanceId, command.expectedRevision);
    const nodeInstance = mapRow(row);
    await this.record(nodeInstance, command.actorUserId, "NODE_INSTANCE_ARCHIVED");
    return nodeInstance;
  }

  async listEdgesByInvestigation(investigationId: string): Promise<WorkflowEdge[]> {
    const result = await this.database.connection().execute(sql`
      SELECT id, investigation_id, from_node_instance_id, to_node_instance_id, created_at
      FROM workflow_edges WHERE investigation_id = ${investigationId}
    `);
    return (result.rows as WorkflowEdgeRow[]).map(mapEdgeRow);
  }

  async createEdge(command: CreateWorkflowEdgeCommand): Promise<WorkflowEdge> {
    this.requireTransaction();
    const id = newUuid();
    const now = new Date();
    await this.database.connection().execute(sql`
      INSERT INTO workflow_edges (id, investigation_id, from_node_instance_id, to_node_instance_id, created_at)
      VALUES (${id}, ${command.investigationId}, ${command.fromNodeInstanceId}, ${command.toNodeInstanceId}, ${now})
    `);
    await this.outbox.enqueue({
      type: "WORKFLOW_EDGE_CREATED",
      version: 1,
      aggregate: { type: "WORKFLOW_EDGE", id },
      payload: {
        workflowEdgeId: id,
        investigationId: command.investigationId,
        fromNodeInstanceId: command.fromNodeInstanceId,
        toNodeInstanceId: command.toNodeInstanceId,
      },
      occurredAt: now,
    });
    return Object.freeze({
      id,
      investigationId: command.investigationId,
      fromNodeInstanceId: command.fromNodeInstanceId,
      toNodeInstanceId: command.toNodeInstanceId,
      createdAt: now,
    });
  }

  private async record(
    value: NodeInstance,
    actorUserId: string,
    type: string,
  ): Promise<void> {
    const configurationHash = createHash("sha256")
      .update(JSON.stringify(value.configuration))
      .digest("hex");
    await this.database.connection().execute(sql`
      INSERT INTO node_instance_revisions
        (node_instance_id, revision, status, configuration_hash, actor_user_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.status}, ${configurationHash}, ${actorUserId}, ${value.updatedAt})
    `);
    await this.outbox.enqueue({
      type,
      version: 1,
      aggregate: { type: "NODE_INSTANCE", id: value.id },
      payload: {
        nodeInstanceId: value.id,
        workspaceId: value.workspaceId,
        caseId: value.caseId,
        investigationId: value.investigationId,
        revision: value.revision,
        status: value.status,
      },
      occurredAt: value.updatedAt,
    });
  }

  private async revisionMismatch(id: string, expectedRevision: number): Promise<never> {
    const current = await this.find(id);
    if (!current)
      throw new AppError({
        code: "NODE_INSTANCE_NOT_FOUND",
        message: "NodeInstance was not found.",
        statusCode: 404,
      });
    if (current.status === "ARCHIVED")
      throw new AppError({
        code: "NODE_INSTANCE_ARCHIVED",
        message: "An archived NodeInstance cannot be changed.",
        statusCode: 409,
      });
    throw new AppError({
      code: "CONFLICT_REVISION_MISMATCH",
      message: "The resource has changed since it was read.",
      statusCode: 412,
      details: { expectedRevision, actualRevision: current.revision },
    });
  }

  private requireTransaction(): void {
    if (!currentTransaction())
      throw new Error("NodeInstance writes require a transaction.");
  }
}

type NodeInstanceRow = {
  id: string;
  workspace_id: string;
  case_id: string;
  investigation_id: string;
  node_definition_key: string;
  node_definition_version: number;
  configuration: NodeInstanceConfiguration;
  status: NodeInstanceStatus;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
};

function mapRow(row: NodeInstanceRow): NodeInstance {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspace_id,
    caseId: row.case_id,
    investigationId: row.investigation_id,
    nodeDefinitionKey: row.node_definition_key,
    nodeDefinitionVersion: row.node_definition_version,
    configuration: Object.freeze({ ...row.configuration }),
    status: row.status,
    revision: row.revision,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  });
}

type InputBindingRow = {
  target_input: string;
  source_expression: string;
  source_type: InputBinding["sourceType"];
  source_classification: InputBinding["sourceClassification"];
};

function mapBindingRow(row: InputBindingRow): InputBinding {
  return Object.freeze({
    targetInput: row.target_input,
    sourceExpression: row.source_expression,
    sourceType: row.source_type,
    sourceClassification: row.source_classification,
  });
}

type WorkflowEdgeRow = {
  id: string;
  investigation_id: string;
  from_node_instance_id: string;
  to_node_instance_id: string;
  created_at: Date | string;
};

function mapEdgeRow(row: WorkflowEdgeRow): WorkflowEdge {
  return Object.freeze({
    id: row.id,
    investigationId: row.investigation_id,
    fromNodeInstanceId: row.from_node_instance_id,
    toNodeInstanceId: row.to_node_instance_id,
    createdAt: new Date(row.created_at),
  });
}
