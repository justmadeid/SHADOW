import type { InputBinding } from "./input-binding.js";
import type { NodeInstance, NodeInstanceConfiguration } from "./node-instance.js";
import type { WorkflowEdge } from "./workflow-edge.js";

export const NODE_INSTANCE_REPOSITORY = Symbol("NODE_INSTANCE_REPOSITORY");

export type CreateNodeInstanceCommand = {
  workspaceId: string;
  caseId: string;
  investigationId: string;
  nodeDefinitionKey: string;
  nodeDefinitionVersion: number;
  configuration: NodeInstanceConfiguration;
  ready: boolean;
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
};

export type CreateNodeInstanceResult = { nodeInstance: NodeInstance; replayed: boolean };

export type ReplaceInputBindingsCommand = {
  nodeInstanceId: string;
  bindings: InputBinding[];
  ready: boolean;
  expectedRevision: number;
  actorUserId: string;
};

export type UpdateConfigurationCommand = {
  nodeInstanceId: string;
  configuration: NodeInstanceConfiguration;
  expectedRevision: number;
  actorUserId: string;
};

export type ArchiveNodeInstanceCommand = {
  nodeInstanceId: string;
  expectedRevision: number;
  actorUserId: string;
};

export type CreateWorkflowEdgeCommand = {
  investigationId: string;
  fromNodeInstanceId: string;
  toNodeInstanceId: string;
  actorUserId: string;
};

export interface NodeInstanceRepository {
  create(command: CreateNodeInstanceCommand): Promise<CreateNodeInstanceResult>;
  find(id: string): Promise<NodeInstance | undefined>;
  listInputBindings(nodeInstanceId: string): Promise<InputBinding[]>;
  replaceInputBindings(command: ReplaceInputBindingsCommand): Promise<NodeInstance>;
  updateConfiguration(command: UpdateConfigurationCommand): Promise<NodeInstance>;
  archive(command: ArchiveNodeInstanceCommand): Promise<NodeInstance>;
  listEdgesByInvestigation(investigationId: string): Promise<WorkflowEdge[]>;
  createEdge(command: CreateWorkflowEdgeCommand): Promise<WorkflowEdge>;
}
