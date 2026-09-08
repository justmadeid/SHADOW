import type { NodeDefinition, NodeDefinitionInput } from "./node-definition.js";

export type NodeDefinitionPage = {
  items: NodeDefinition[];
  page: { hasMore: boolean; nextCursor: string | null };
};

/**
 * Key+version catalog port. `register` is a trusted application port, never a
 * DTO supplied by an HTTP caller (mirrors CanonicalEntityResolver's posture):
 * it is called directly by trusted application code (this module's own
 * bootstrap, and future capability-owning modules such as a Source
 * Registry/connector task), not wired to any HTTP controller.
 */
export interface NodeDefinitionRegistry {
  /**
   * Idempotent on exact key+version: an identical-shape replay returns the
   * existing row. A different shape for an existing key+version is a 409
   * CONFLICT_NODE_DEFINITION_KEY_VERSION_REUSED.
   */
  register(input: NodeDefinitionInput): Promise<NodeDefinition>;
  findByKeyVersion(key: string, version: number): Promise<NodeDefinition | undefined>;
  findLatestActiveByKey(key: string): Promise<NodeDefinition | undefined>;
  list(limit: number, cursor?: string): Promise<NodeDefinitionPage>;
}
