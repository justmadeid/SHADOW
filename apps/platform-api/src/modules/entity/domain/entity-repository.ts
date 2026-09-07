import type { CreateEntityInput, Entity, UpdateEntityInput } from "./entity.js";

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
  list(workspaceId: string, limit: number, before?: string): Promise<Entity[]>;
  update(current: Entity, input: UpdateEntityInput, actorUserId: string): Promise<Entity>;
}
