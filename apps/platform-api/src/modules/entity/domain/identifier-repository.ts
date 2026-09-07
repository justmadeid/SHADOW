import type { CreateIdentifierInput, EntityIdentifier } from "./identifier.js";

export const IDENTIFIER_REPOSITORY = Symbol("IDENTIFIER_REPOSITORY");

export interface IdentifierRepository {
  create(
    command: CreateIdentifierInput & {
      entityId: string;
      workspaceId: string;
      actorUserId: string;
      idempotencyKey: string;
    },
  ): Promise<EntityIdentifier>;
  find(id: string): Promise<EntityIdentifier | undefined>;
  list(entityId: string, workspaceId: string): Promise<EntityIdentifier[]>;
  reveal(id: string): Promise<string>;
}
