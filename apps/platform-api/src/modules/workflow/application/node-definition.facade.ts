import { Inject, Injectable } from "@nestjs/common";

import { DrizzleTransactionManager } from "@intelligence/database";
import { AppError } from "../../../platform/errors/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import type { NodeDefinition, NodeDefinitionInput } from "../domain/node-definition.js";
import type {
  NodeDefinitionPage,
  NodeDefinitionRegistry,
} from "../domain/node-definition-registry.js";
import { NODE_DEFINITION_REGISTRY } from "../workflow.tokens.js";

@Injectable()
export class NodeDefinitionFacade {
  constructor(
    @Inject(NODE_DEFINITION_REGISTRY)
    private readonly registry: NodeDefinitionRegistry,
    @Inject(DrizzleTransactionManager)
    private readonly transactions: DrizzleTransactionManager,
    @Inject(RequestContextStore)
    private readonly context: RequestContextStore,
  ) {}

  /**
   * Trusted application port, never a DTO supplied by an HTTP caller. There is
   * no public write HTTP endpoint for the NodeDefinition catalog (see
   * docs/knowledge/15_PLATFORM_API_CONTRACT_MAP.md §12) — only trusted
   * application code (this module's own bootstrap today, a future capability-
   * owning module such as a Source Registry/connector task later) may call
   * this directly.
   */
  async register(input: NodeDefinitionInput): Promise<NodeDefinition> {
    return this.transactions.run(() => this.registry.register(input));
  }

  async get(key: string, version: number): Promise<NodeDefinition> {
    this.requireAuth();
    const found = await this.registry.findByKeyVersion(key, version);
    if (!found) return this.notFound();
    return found;
  }

  async list(limit = 50, cursor?: string): Promise<NodeDefinitionPage> {
    this.requireAuth();
    const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50;
    return this.registry.list(bounded, cursor);
  }

  /**
   * Requires an ACTIVE NodeDefinition for the given key+version. Used by the
   * NodeInstance facade to resolve the capability template a NodeInstance is
   * bound to; 404 if the key+version is unknown, 409 if it exists but is
   * DEPRECATED.
   */
  async requireActive(key: string, version: number): Promise<NodeDefinition> {
    this.requireAuth();
    const found = await this.registry.findByKeyVersion(key, version);
    if (!found) return this.notFound();
    if (found.status !== "ACTIVE")
      throw new AppError({
        code: "NODE_DEFINITION_NOT_ACTIVE",
        message: "The NodeDefinition version is deprecated.",
        statusCode: 409,
      });
    return found;
  }

  /** Looks up an existing NodeDefinition by key+version regardless of status. */
  async findByKeyVersion(
    key: string,
    version: number,
  ): Promise<NodeDefinition | undefined> {
    return this.registry.findByKeyVersion(key, version);
  }

  private requireAuth(): void {
    const principal = this.context.get().principal;
    if (!principal)
      throw new AppError({
        code: "AUTH_REQUIRED",
        message: "This operation requires an authenticated principal.",
        statusCode: 401,
      });
  }

  private notFound(): never {
    throw new AppError({
      code: "NODE_DEFINITION_NOT_FOUND",
      message: "NodeDefinition version was not found.",
      statusCode: 404,
    });
  }
}
