import type {
  CreateEntityInput,
  Entity,
  EntityMergeDecision,
  EntityMergeReasonCode,
  EntityMergeReversalDecision,
  EntityMergeReverseReasonCode,
  UpdateEntityInput,
} from "./entity.js";

export const ENTITY_REPOSITORY = Symbol("ENTITY_REPOSITORY");

export interface EntityRepository {
  create(
    command: CreateEntityInput & {
      workspaceId: string;
      actorUserId: string;
      idempotencyKey: string;
    },
  ): Promise<Entity>;
  find(id: string): Promise<Entity | undefined>;
  findMany(ids: readonly string[]): Promise<Entity[]>;
  findManyForUpdate(ids: readonly string[]): Promise<Entity[]>;
  list(workspaceId: string, limit: number, before?: string): Promise<Entity[]>;
  update(current: Entity, input: UpdateEntityInput, actorUserId: string): Promise<Entity>;
  findMerge(id: string): Promise<EntityMergeDecision | undefined>;
  merge(command: {
    workspaceId: string;
    survivorEntityId: string;
    absorbedEntityId: string;
    survivorRevision: number;
    absorbedRevision: number;
    reasonCode: EntityMergeReasonCode;
    actorUserId: string;
    idempotencyKey: string;
    requestHash: string;
    operationId: string;
  }): Promise<{ decision: EntityMergeDecision; replayed: boolean }>;
  reverseMerge(command: {
    mergeId: string;
    workspaceId: string;
    survivorRevision: number;
    absorbedRevision: number;
    reasonCode: EntityMergeReverseReasonCode;
    actorUserId: string;
    idempotencyKey: string;
    requestHash: string;
    operationId: string;
  }): Promise<{ decision: EntityMergeReversalDecision; replayed: boolean }>;
}
