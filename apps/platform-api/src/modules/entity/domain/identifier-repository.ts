import type { EntityType } from "./entity.js";
import type {
  CreateIdentifierInput,
  EntityIdentifier,
  IdentifierType,
} from "./identifier.js";

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
  findExactMatches(input: {
    workspaceId: string;
    type: IdentifierType;
    normalizedValue: string;
    limit: number;
  }): Promise<
    Array<{
      entityId: string;
      workspaceId: string;
      entityType: EntityType;
      entityRevision: number;
      classification: EntityIdentifier["classification"];
    }>
  >;
  reveal(id: string): Promise<string>;
}
