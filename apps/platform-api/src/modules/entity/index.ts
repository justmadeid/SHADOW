export { EntityModule } from "./entity.module.js";
export { EntityFacade } from "./application/entity.facade.js";
export { IdentifierFacade } from "./application/identifier.facade.js";
export { IDENTIFIER_ACCESS_REASONS } from "./application/identifier.facade.js";
export {
  ENTITY_TYPES,
  ENTITY_STATUSES,
  ENTITY_MERGE_REASON_CODES,
  type Entity,
  type EntityAlias,
  type EntityMergeDecision,
  type EntityMergeReasonCode,
  type EntityRef,
  type EntityStatus,
  type EntityType,
} from "./domain/entity.js";
export {
  IDENTIFIER_TYPES,
  IDENTIFIER_STATUSES,
  type EntityIdentifier,
  type IdentifierStatus,
  type IdentifierType,
  type IdentifierView,
} from "./domain/identifier.js";
