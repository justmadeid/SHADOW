import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DrizzleTransactionManager } from "@intelligence/database";
import { CaseFacade } from "../../case/index.js";
import { InvestigationFacade } from "../../investigation/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { NodeDefinitionFacade } from "./node-definition.facade.js";
import { validateInputBindings, type InputBinding } from "../domain/input-binding.js";
import type {
  CreateNodeInstanceBody,
  UpdateNodeInstanceBody,
} from "../domain/node-instance-input.js";
import {
  computeReadiness,
  validateConfigurationAgainstSchema,
  type NodeInstance,
} from "../domain/node-instance.js";
import {
  NODE_INSTANCE_REPOSITORY,
  type NodeInstanceRepository,
} from "../domain/node-instance-repository.js";
import { assertValidEdgeCandidate } from "../domain/workflow-edge.js";
import type { WorkflowEdge } from "../domain/workflow-edge.js";

@Injectable()
export class NodeInstanceFacade {
  constructor(
    @Inject(NODE_INSTANCE_REPOSITORY)
    private readonly repository: NodeInstanceRepository,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore)
    private readonly context: RequestContextStore,
    @Inject(CaseFacade) private readonly cases: CaseFacade,
    @Inject(InvestigationFacade) private readonly investigations: InvestigationFacade,
    @Inject(NodeDefinitionFacade) private readonly nodeDefinitions: NodeDefinitionFacade,
  ) {}

  async create(
    investigationId: string,
    body: CreateNodeInstanceBody,
    idempotencyKey: string,
  ): Promise<NodeInstance> {
    const actorUserId = this.requireUser();
    const found = await this.investigations.get(investigationId);
    return this.cases.withAccess(found.caseId, "WORKFLOW_CREATE", async (parent) => {
      const investigation = await this.investigations.get(investigationId);
      if (investigation.workspaceId !== parent.workspaceId)
        return this.investigationNotFound();
      if (investigation.status !== "ACTIVE")
        throw new AppError({
          code: "NODE_INSTANCE_INVESTIGATION_NOT_ACTIVE",
          message: "NodeInstance creation requires an active Investigation.",
          statusCode: 409,
        });

      const definition = await this.nodeDefinitions.requireActive(
        body.nodeDefinitionKey,
        body.nodeDefinitionVersion,
      );
      const configuration = validateConfigurationAgainstSchema(
        body.configuration,
        definition.configSchema,
      );
      const requiredInputs = definition.inputs
        .filter((field) => field.required)
        .map((field) => field.name);
      const ready = computeReadiness(requiredInputs, []);

      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            investigationId,
            nodeDefinitionKey: definition.key,
            nodeDefinitionVersion: definition.version,
            configuration,
          }),
        )
        .digest("hex");

      const result = await this.transactions.run(() =>
        this.repository.create({
          workspaceId: parent.workspaceId,
          caseId: parent.id,
          investigationId,
          nodeDefinitionKey: definition.key,
          nodeDefinitionVersion: definition.version,
          configuration,
          ready,
          actorUserId,
          idempotencyKey,
          requestHash,
        }),
      );
      return result.nodeInstance;
    });
  }

  async get(id: string): Promise<NodeInstance> {
    this.requireUser();
    const found = await this.repository.find(id);
    if (!found) return this.notFound();
    try {
      const parent = await this.cases.get(found.caseId, "WORKFLOW_VIEW");
      if (parent.workspaceId !== found.workspaceId) return this.notFound();
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return this.notFound();
      throw error;
    }
    return found;
  }

  async listInputBindings(id: string): Promise<InputBinding[]> {
    await this.get(id);
    return this.repository.listInputBindings(id);
  }

  async updateConfiguration(
    id: string,
    body: UpdateNodeInstanceBody,
    expectedRevision: number,
  ): Promise<NodeInstance> {
    const actorUserId = this.requireUser();
    const found = await this.get(id);
    return this.cases.withAccess(found.caseId, "WORKFLOW_UPDATE", async () => {
      const current = await this.requireCurrent(id);
      assertExpectedRevision(expectedRevision, current.revision);
      this.assertNotArchived(current);
      const definition = await this.nodeDefinitions.findByKeyVersion(
        current.nodeDefinitionKey,
        current.nodeDefinitionVersion,
      );
      if (!definition)
        throw new Error("NodeInstance references an unknown NodeDefinition.");
      const configuration = validateConfigurationAgainstSchema(
        body.configuration,
        definition.configSchema,
      );
      return this.repository.updateConfiguration({
        nodeInstanceId: id,
        configuration,
        expectedRevision,
        actorUserId,
      });
    });
  }

  async replaceInputBindings(
    id: string,
    rawBindings: unknown[],
    expectedRevision: number,
  ): Promise<NodeInstance> {
    const actorUserId = this.requireUser();
    const found = await this.get(id);
    return this.cases.withAccess(found.caseId, "WORKFLOW_UPDATE", async () => {
      const current = await this.requireCurrent(id);
      assertExpectedRevision(expectedRevision, current.revision);
      this.assertNotArchived(current);
      const definition = await this.nodeDefinitions.findByKeyVersion(
        current.nodeDefinitionKey,
        current.nodeDefinitionVersion,
      );
      if (!definition)
        throw new Error("NodeInstance references an unknown NodeDefinition.");
      const bindings = validateInputBindings(rawBindings, definition.inputs);
      const requiredInputs = definition.inputs
        .filter((field) => field.required)
        .map((field) => field.name);
      const ready = computeReadiness(
        requiredInputs,
        bindings.map((binding) => binding.targetInput),
      );
      return this.repository.replaceInputBindings({
        nodeInstanceId: id,
        bindings,
        ready,
        expectedRevision,
        actorUserId,
      });
    });
  }

  async archive(id: string, expectedRevision: number): Promise<NodeInstance> {
    const actorUserId = this.requireUser();
    const found = await this.get(id);
    return this.cases.withAccess(found.caseId, "WORKFLOW_UPDATE", async () => {
      const current = await this.requireCurrent(id);
      assertExpectedRevision(expectedRevision, current.revision);
      this.assertNotArchived(current);
      return this.repository.archive({
        nodeInstanceId: id,
        expectedRevision,
        actorUserId,
      });
    });
  }

  async createEdge(
    investigationId: string,
    fromNodeInstanceId: string,
    toNodeInstanceId: string,
  ): Promise<WorkflowEdge> {
    const actorUserId = this.requireUser();
    const found = await this.investigations.get(investigationId);
    return this.cases.withAccess(found.caseId, "WORKFLOW_CREATE", async (parent) => {
      const investigation = await this.investigations.get(investigationId);
      if (investigation.workspaceId !== parent.workspaceId)
        return this.investigationNotFound();

      for (const nodeInstanceId of [fromNodeInstanceId, toNodeInstanceId]) {
        const node = await this.repository.find(nodeInstanceId);
        if (
          !node ||
          node.investigationId !== investigationId ||
          node.caseId !== parent.id ||
          node.workspaceId !== parent.workspaceId
        )
          throw new AppError({
            code: "NODE_INSTANCE_NOT_FOUND",
            message: "NodeInstance was not found in this Investigation.",
            statusCode: 404,
          });
      }

      const existingEdges =
        await this.repository.listEdgesByInvestigation(investigationId);
      assertValidEdgeCandidate(fromNodeInstanceId, toNodeInstanceId, existingEdges);

      return this.transactions.run(() =>
        this.repository.createEdge({
          investigationId,
          fromNodeInstanceId,
          toNodeInstanceId,
          actorUserId,
        }),
      );
    });
  }

  private async requireCurrent(id: string): Promise<NodeInstance> {
    const current = await this.repository.find(id);
    if (!current) return this.notFound();
    return current;
  }

  private assertNotArchived(current: NodeInstance): void {
    if (current.status === "ARCHIVED")
      throw new AppError({
        code: "NODE_INSTANCE_ARCHIVED",
        message: "An archived NodeInstance cannot be changed.",
        statusCode: 409,
      });
  }

  private requireUser(): string {
    const principal = this.context.get().principal;
    if (!principal || principal.kind !== "USER")
      throw new AppError({
        code: "AUTH_USER_REQUIRED",
        message: "This operation requires an authenticated user.",
        statusCode: 403,
      });
    return principal.userId;
  }

  private notFound(): never {
    throw new AppError({
      code: "NODE_INSTANCE_NOT_FOUND",
      message: "NodeInstance was not found.",
      statusCode: 404,
    });
  }

  private investigationNotFound(): never {
    throw new AppError({
      code: "INVESTIGATION_NOT_FOUND",
      message: "Investigation was not found.",
      statusCode: 404,
    });
  }
}
