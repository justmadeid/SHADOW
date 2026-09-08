import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import {
  addEntityAlias,
  archiveEntity,
  createEntity,
  labelKey,
  mergeEntities,
  normalizeCreateEntity,
  renameEntity,
  reverseEntityMerge,
  type Entity,
  type EntityAlias,
  type EntityMergeDecision,
  type EntityMergeReversalDecision,
  type EntityType,
  type UpdateEntityInput,
} from "../../domain/entity.js";
import type { EntityRepository } from "../../domain/entity-repository.js";

export class PostgresEntityRepository implements EntityRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async create(command: Parameters<EntityRepository["create"]>[0]): Promise<Entity> {
    this.requireTransaction();
    const normalized = normalizeCreateEntity(command);
    const db = this.database.connection();
    const lock = `entity-create:${command.actorUserId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
    const replay = await db.execute(sql`
      SELECT entity_id FROM entity_idempotency
      WHERE user_id = ${command.actorUserId}
        AND idempotency_key = ${command.idempotencyKey}`);
    const replayId = (replay.rows[0] as { entity_id: string } | undefined)?.entity_id;
    if (replayId) {
      const existing = await this.find(replayId);
      if (!existing) throw new Error("Invalid Entity replay record.");
      if (
        existing.workspaceId !== command.workspaceId ||
        !(await this.sameCreation(replayId, normalized))
      )
        conflict();
      return existing;
    }

    const now = new Date();
    const aliases: EntityAlias[] = (normalized.aliases ?? []).map((label) => ({
      id: newUuid(),
      label,
      createdAt: now.toISOString(),
    }));
    const value = createEntity(
      {
        id: newUuid(),
        workspaceId: command.workspaceId,
        type: normalized.type,
        canonicalLabel: normalized.canonicalLabel,
        aliases,
      },
      now,
    );
    await db.execute(sql`INSERT INTO entities
      (id, workspace_id, entity_type, status, canonical_label, canonical_label_normalized,
       merged_into_id, revision, created_by_user_id, created_at, updated_at)
      VALUES (${value.id}, ${value.workspaceId}, ${value.type}, ${value.status},
        ${value.canonicalLabel}, ${labelKey(value.canonicalLabel)}, null, 1,
        ${command.actorUserId}, ${value.createdAt}, ${value.updatedAt})`);
    for (const alias of value.aliases) await this.insertAlias(value, alias, 1);
    await db.execute(sql`INSERT INTO entity_idempotency
      (user_id, idempotency_key, entity_id, created_at)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${value.id}, ${now})`);
    await this.record(value, command.actorUserId, "ENTITY_CREATED");
    return value;
  }

  async find(id: string): Promise<Entity | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT e.*, COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'label', a.label, 'createdAt', a.created_at
        ) ORDER BY a.normalized_label, a.id)
        FROM entity_aliases a
        WHERE a.entity_id = e.id
          AND a.normalized_label <> e.canonical_label_normalized
      ), '[]'::jsonb) AS aliases
      FROM entities e WHERE e.id = ${id}`);
    const row = result.rows[0] as EntityRow | undefined;
    return row ? mapEntity(row) : undefined;
  }

  async findMany(ids: readonly string[]): Promise<Entity[]> {
    if (ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    const result = await this.database.connection().execute(sql`
      SELECT e.*, COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'label', a.label, 'createdAt', a.created_at
        ) ORDER BY a.normalized_label, a.id)
        FROM entity_aliases a
        WHERE a.entity_id = e.id
          AND a.normalized_label <> e.canonical_label_normalized
      ), '[]'::jsonb) AS aliases
      FROM entities e
      WHERE e.id IN (${sql.join(
        uniqueIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`);
    return (result.rows as EntityRow[]).map(mapEntity);
  }

  async findManyForUpdate(ids: readonly string[]): Promise<Entity[]> {
    this.requireTransaction();
    if (ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)].slice(0, 100);
    const result = await this.database.connection().execute(sql`
      SELECT e.*, COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'label', a.label, 'createdAt', a.created_at
        ) ORDER BY a.normalized_label, a.id)
        FROM entity_aliases a
        WHERE a.entity_id = e.id
          AND a.normalized_label <> e.canonical_label_normalized
      ), '[]'::jsonb) AS aliases
      FROM entities e
      WHERE e.id IN (${sql.join(
        uniqueIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      ORDER BY e.id
      FOR UPDATE OF e`);
    return (result.rows as EntityRow[]).map(mapEntity);
  }

  async list(workspaceId: string, limit: number, before?: string): Promise<Entity[]> {
    const bound = Math.max(1, Math.min(101, Math.floor(limit)));
    const result = await this.database.connection().execute(sql`
      SELECT e.*, COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', a.id, 'label', a.label, 'createdAt', a.created_at
        ) ORDER BY a.normalized_label, a.id)
        FROM entity_aliases a
        WHERE a.entity_id = e.id
          AND a.normalized_label <> e.canonical_label_normalized
      ), '[]'::jsonb) AS aliases
      FROM entities e
      WHERE e.workspace_id = ${workspaceId}
        ${before ? sql`AND e.id < ${before}::uuid` : sql``}
      ORDER BY e.id DESC LIMIT ${bound}`);
    return (result.rows as EntityRow[]).map(mapEntity);
  }

  async findMerge(id: string): Promise<EntityMergeDecision | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT * FROM entity_merges WHERE id = ${id}`);
    const row = result.rows[0] as EntityMergeRow | undefined;
    return row ? mapEntityMerge(row) : undefined;
  }

  async update(
    current: Entity,
    input: UpdateEntityInput,
    actorUserId: string,
  ): Promise<Entity> {
    this.requireTransaction();
    const now = new Date();
    const persistedOldLabel =
      "canonicalLabel" in input
        ? await this.findAlias(current.id, current.canonicalLabel)
        : null;
    const value =
      "canonicalLabel" in input
        ? renameEntity(
            current,
            input.canonicalLabel,
            persistedOldLabel ?? {
              id: newUuid(),
              label: current.canonicalLabel,
              createdAt: now.toISOString(),
            },
            current.revision,
            now,
          )
        : "alias" in input
          ? addEntityAlias(
              current,
              { id: newUuid(), label: input.alias, createdAt: now.toISOString() },
              current.revision,
              now,
            )
          : archiveEntity(current, current.revision, now);
    const updated = await this.database.connection().execute(sql`UPDATE entities
      SET canonical_label = ${value.canonicalLabel},
        canonical_label_normalized = ${labelKey(value.canonicalLabel)},
        status = ${value.status}, revision = ${value.revision}, updated_at = ${value.updatedAt}
      WHERE id = ${current.id} AND workspace_id = ${current.workspaceId}
        AND revision = ${current.revision} RETURNING id`);
    if (!updated.rows.length)
      throw new AppError({
        code: "CONFLICT_REVISION_MISMATCH",
        message: "The resource has changed since it was read.",
        statusCode: 412,
      });

    if ("canonicalLabel" in input) {
      const oldAlias = value.aliases.find(
        (alias) => labelKey(alias.label) === labelKey(current.canonicalLabel),
      );
      if (oldAlias) await this.insertAlias(value, oldAlias, value.revision);
    } else if ("alias" in input) {
      await this.insertAlias(value, value.aliases.at(-1)!, value.revision);
    }
    await this.record(
      value,
      actorUserId,
      value.status === "ARCHIVED" ? "ENTITY_ARCHIVED" : "ENTITY_UPDATED",
    );
    return value;
  }

  async merge(
    command: Parameters<EntityRepository["merge"]>[0],
  ): Promise<{ decision: EntityMergeDecision; replayed: boolean }> {
    this.requireTransaction();
    const db = this.database.connection();
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`entity-merge:${command.actorUserId}:${command.idempotencyKey}`}, 0))`,
    );
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`entity-merge-workspace:${command.workspaceId}`}, 0))`,
    );

    const replay = await db.execute(sql`
      SELECT m.*, i.request_hash FROM entity_merge_idempotency i
      JOIN entity_merges m ON m.id = i.merge_id
      WHERE i.user_id = ${command.actorUserId}
        AND i.idempotency_key = ${command.idempotencyKey}`);
    const replayRow = replay.rows[0] as
      (EntityMergeRow & { request_hash: string }) | undefined;
    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash) conflict();
      return { decision: mapEntityMerge(replayRow), replayed: true };
    }

    const operation = await db.execute(sql`SELECT id FROM entity_merges
      WHERE workspace_id = ${command.workspaceId}
        AND operation_id = ${command.operationId}`);
    if (operation.rows.length) operationConflict();

    const current = new Map(
      (
        await this.findManyForUpdate([command.survivorEntityId, command.absorbedEntityId])
      ).map((entity) => [entity.id, entity]),
    );
    const survivor = current.get(command.survivorEntityId);
    const absorbed = current.get(command.absorbedEntityId);
    if (
      !survivor ||
      !absorbed ||
      survivor.workspaceId !== command.workspaceId ||
      absorbed.workspaceId !== command.workspaceId
    )
      mergeNotFound();
    await this.assertMergeDepth(command.workspaceId, absorbed.id);

    const now = new Date();
    const merged = mergeEntities(
      survivor,
      absorbed,
      command.survivorRevision,
      command.absorbedRevision,
      now,
    );
    const survivorUpdated = await db.execute(sql`UPDATE entities
      SET revision = ${merged.survivor.revision}, updated_at = ${merged.survivor.updatedAt}
      WHERE id = ${survivor.id} AND workspace_id = ${command.workspaceId}
        AND revision = ${survivor.revision} RETURNING id`);
    const absorbedUpdated = await db.execute(sql`UPDATE entities
      SET status = ${merged.absorbed.status}, merged_into_id = ${survivor.id},
        revision = ${merged.absorbed.revision}, updated_at = ${merged.absorbed.updatedAt}
      WHERE id = ${absorbed.id} AND workspace_id = ${command.workspaceId}
        AND revision = ${absorbed.revision} RETURNING id`);
    if (!survivorUpdated.rows.length || !absorbedUpdated.rows.length) revisionConflict();

    const decision: EntityMergeDecision = Object.freeze({
      id: newUuid(),
      operationId: command.operationId,
      workspaceId: command.workspaceId,
      survivorEntityId: survivor.id,
      absorbedEntityId: absorbed.id,
      survivorRevision: merged.survivor.revision,
      absorbedRevision: merged.absorbed.revision,
      reasonCode: command.reasonCode,
      createdAt: now.toISOString(),
    });
    await db.execute(sql`INSERT INTO entity_merges
      (id, operation_id, workspace_id, survivor_entity_id, absorbed_entity_id,
       survivor_revision_before, survivor_revision_after, absorbed_revision_before,
       absorbed_revision_after, reason_code, actor_user_id, created_at)
      VALUES (${decision.id}, ${decision.operationId}, ${decision.workspaceId},
        ${decision.survivorEntityId}, ${decision.absorbedEntityId},
        ${survivor.revision}, ${decision.survivorRevision}, ${absorbed.revision},
        ${decision.absorbedRevision}, ${decision.reasonCode}, ${command.actorUserId},
        ${decision.createdAt})`);
    await db.execute(sql`INSERT INTO entity_merge_idempotency
      (user_id, idempotency_key, request_hash, merge_id, created_at)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${command.requestHash},
        ${decision.id}, ${decision.createdAt})`);
    await this.recordRevision(merged.survivor, command.actorUserId);
    await this.recordRevision(merged.absorbed, command.actorUserId);
    await this.outbox.enqueue({
      type: "ENTITY_MERGED",
      version: 1,
      aggregate: { type: "ENTITY_MERGE", id: decision.id },
      payload: {
        entityMergeId: decision.id,
        workspaceId: decision.workspaceId,
        survivorEntityId: decision.survivorEntityId,
        absorbedEntityId: decision.absorbedEntityId,
        survivorRevision: decision.survivorRevision,
        absorbedRevision: decision.absorbedRevision,
      },
      occurredAt: now,
    });
    return { decision, replayed: false };
  }

  async reverseMerge(
    command: Parameters<EntityRepository["reverseMerge"]>[0],
  ): Promise<{ decision: EntityMergeReversalDecision; replayed: boolean }> {
    this.requireTransaction();
    const db = this.database.connection();
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`entity-merge-reverse:${command.actorUserId}:${command.idempotencyKey}`}, 0))`,
    );
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`entity-merge-workspace:${command.workspaceId}`}, 0))`,
    );

    const replay = await db.execute(sql`
      SELECT r.*, i.request_hash FROM entity_merge_reversal_idempotency i
      JOIN entity_merge_reversals r ON r.id = i.reversal_id
      WHERE i.user_id = ${command.actorUserId}
        AND i.idempotency_key = ${command.idempotencyKey}`);
    const replayRow = replay.rows[0] as
      (EntityMergeReversalRow & { request_hash: string }) | undefined;
    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash) conflict();
      return { decision: mapEntityMergeReversal(replayRow), replayed: true };
    }

    const operation = await db.execute(sql`SELECT id FROM entity_merge_reversals
      WHERE workspace_id = ${command.workspaceId}
        AND operation_id = ${command.operationId}`);
    if (operation.rows.length) reverseOperationConflict();

    const mergeResult = await db.execute(sql`SELECT * FROM entity_merges
      WHERE id = ${command.mergeId} AND workspace_id = ${command.workspaceId}`);
    const mergeRow = mergeResult.rows[0] as EntityMergeRow | undefined;
    if (!mergeRow) entityMergeNotFound();
    const merge = mapEntityMerge(mergeRow);
    const previous = await db.execute(sql`SELECT id FROM entity_merge_reversals
      WHERE merge_id = ${merge.id}`);
    if (previous.rows.length) alreadyReversed();

    const current = new Map(
      (
        await this.findManyForUpdate([merge.survivorEntityId, merge.absorbedEntityId])
      ).map((entity) => [entity.id, entity]),
    );
    const survivor = current.get(merge.survivorEntityId);
    const absorbed = current.get(merge.absorbedEntityId);
    if (
      !survivor ||
      !absorbed ||
      survivor.workspaceId !== command.workspaceId ||
      absorbed.workspaceId !== command.workspaceId
    )
      entityMergeNotFound();

    const now = new Date();
    const reversed = reverseEntityMerge(
      survivor,
      absorbed,
      merge,
      command.survivorRevision,
      command.absorbedRevision,
      now,
    );
    const survivorUpdated = await db.execute(sql`UPDATE entities
      SET revision = ${reversed.survivor.revision},
        updated_at = ${reversed.survivor.updatedAt}
      WHERE id = ${survivor.id} AND workspace_id = ${command.workspaceId}
        AND revision = ${survivor.revision} RETURNING id`);
    const absorbedUpdated = await db.execute(sql`UPDATE entities
      SET status = ${reversed.restored.status}, merged_into_id = null,
        revision = ${reversed.restored.revision},
        updated_at = ${reversed.restored.updatedAt}
      WHERE id = ${absorbed.id} AND workspace_id = ${command.workspaceId}
        AND revision = ${absorbed.revision} RETURNING id`);
    if (!survivorUpdated.rows.length || !absorbedUpdated.rows.length) revisionConflict();

    const decision: EntityMergeReversalDecision = Object.freeze({
      id: newUuid(),
      operationId: command.operationId,
      entityMergeId: merge.id,
      workspaceId: command.workspaceId,
      survivorEntityId: survivor.id,
      restoredEntityId: absorbed.id,
      survivorRevision: reversed.survivor.revision,
      restoredEntityRevision: reversed.restored.revision,
      reasonCode: command.reasonCode,
      createdAt: now.toISOString(),
    });
    await db.execute(sql`INSERT INTO entity_merge_reversals
      (id, operation_id, merge_id, workspace_id, survivor_entity_id,
       restored_entity_id, survivor_revision_before, survivor_revision_after,
       restored_revision_before, restored_revision_after, reason_code,
       actor_user_id, created_at)
      VALUES (${decision.id}, ${decision.operationId}, ${decision.entityMergeId},
        ${decision.workspaceId}, ${decision.survivorEntityId},
        ${decision.restoredEntityId}, ${survivor.revision},
        ${decision.survivorRevision}, ${absorbed.revision},
        ${decision.restoredEntityRevision}, ${decision.reasonCode},
        ${command.actorUserId}, ${decision.createdAt})`);
    await db.execute(sql`INSERT INTO entity_merge_reversal_idempotency
      (user_id, idempotency_key, request_hash, reversal_id, created_at)
      VALUES (${command.actorUserId}, ${command.idempotencyKey},
        ${command.requestHash}, ${decision.id}, ${decision.createdAt})`);
    await this.recordRevision(reversed.survivor, command.actorUserId);
    await this.recordRevision(reversed.restored, command.actorUserId);
    await this.outbox.enqueue({
      type: "ENTITY_MERGE_REVERSED",
      version: 1,
      aggregate: { type: "ENTITY_MERGE_REVERSAL", id: decision.id },
      payload: {
        entityMergeReversalId: decision.id,
        entityMergeId: decision.entityMergeId,
        workspaceId: decision.workspaceId,
        survivorEntityId: decision.survivorEntityId,
        restoredEntityId: decision.restoredEntityId,
        survivorRevision: decision.survivorRevision,
        restoredEntityRevision: decision.restoredEntityRevision,
      },
      occurredAt: now,
    });
    return { decision, replayed: false };
  }

  private async assertMergeDepth(workspaceId: string, absorbedEntityId: string) {
    const result = await this.database.connection().execute(sql`
      WITH RECURSIVE predecessors(id, depth, path) AS (
        SELECT ${absorbedEntityId}::uuid, 0, ARRAY[${absorbedEntityId}::uuid]
        UNION ALL
        SELECT e.id, p.depth + 1, p.path || e.id
        FROM entities e
        JOIN predecessors p ON e.merged_into_id = p.id
        WHERE e.workspace_id = ${workspaceId}
          AND p.depth < 15
          AND NOT e.id = ANY(p.path)
      )
      SELECT 1 FROM predecessors WHERE depth = 15 LIMIT 1`);
    if (result.rows.length)
      throw new AppError({
        code: "ENTITY_MERGE_CHAIN_LIMIT",
        message: "The Entity merge chain has reached its supported limit.",
        statusCode: 409,
      });
  }

  private async insertAlias(
    entity: Entity,
    alias: EntityAlias,
    revision: number,
  ): Promise<void> {
    await this.database.connection().execute(sql`INSERT INTO entity_aliases
      (id, entity_id, label, normalized_label, revision_added, created_at)
      VALUES (${alias.id}, ${entity.id}, ${alias.label}, ${labelKey(alias.label)},
        ${revision}, ${alias.createdAt}) ON CONFLICT (entity_id, normalized_label) DO NOTHING`);
  }

  private async findAlias(entityId: string, label: string): Promise<EntityAlias | null> {
    const result = await this.database.connection().execute(sql`
      SELECT id, label, created_at FROM entity_aliases
      WHERE entity_id = ${entityId} AND normalized_label = ${labelKey(label)}`);
    const row = result.rows[0] as AliasRow | undefined;
    return row
      ? {
          id: row.id,
          label: row.label,
          createdAt: new Date(row.created_at).toISOString(),
        }
      : null;
  }

  private async sameCreation(
    entityId: string,
    input: ReturnType<typeof normalizeCreateEntity>,
  ): Promise<boolean> {
    const revision = await this.database.connection().execute(sql`
      SELECT entity_type, canonical_label FROM entity_revisions
      WHERE entity_id = ${entityId} AND revision = 1`);
    const row = revision.rows[0] as
      { entity_type: EntityType; canonical_label: string } | undefined;
    if (
      !row ||
      row.entity_type !== input.type ||
      row.canonical_label !== input.canonicalLabel
    )
      return false;
    const aliases = await this.database.connection().execute(sql`
      SELECT label FROM entity_aliases
      WHERE entity_id = ${entityId} AND revision_added = 1
      ORDER BY normalized_label`);
    const original = aliases.rows
      .map((alias) => String(alias.label))
      .sort((left, right) => labelKey(left).localeCompare(labelKey(right)));
    return JSON.stringify(original) === JSON.stringify(input.aliases ?? []);
  }

  private async record(value: Entity, actorUserId: string, eventType: string) {
    await this.recordRevision(value, actorUserId);
    await this.outbox.enqueue({
      type: eventType,
      version: 1,
      aggregate: { type: "ENTITY", id: value.id },
      payload: {
        entityId: value.id,
        workspaceId: value.workspaceId,
        status: value.status,
        revision: value.revision,
      },
      occurredAt: new Date(value.updatedAt),
    });
  }

  private async recordRevision(value: Entity, actorUserId: string) {
    await this.database.connection().execute(sql`INSERT INTO entity_revisions
      (entity_id, revision, entity_type, status, canonical_label, merged_into_id,
       actor_user_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.type}, ${value.status},
        ${value.canonicalLabel}, ${value.mergedInto?.id ?? null}, ${actorUserId},
        ${value.updatedAt})`);
  }

  private requireTransaction() {
    if (!currentTransaction()) throw new Error("Entity writes require a transaction.");
  }
}

type EntityRow = {
  id: string;
  workspace_id: string;
  entity_type: EntityType;
  status: Entity["status"];
  canonical_label: string;
  canonical_label_normalized: string;
  merged_into_id: string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  aliases: { id: string; label: string; createdAt: string }[];
};
type AliasRow = { id: string; label: string; created_at: Date | string };
type EntityMergeRow = {
  id: string;
  operation_id: string;
  workspace_id: string;
  survivor_entity_id: string;
  absorbed_entity_id: string;
  survivor_revision_after: number;
  absorbed_revision_after: number;
  reason_code: EntityMergeDecision["reasonCode"];
  created_at: Date | string;
};
type EntityMergeReversalRow = {
  id: string;
  operation_id: string;
  merge_id: string;
  workspace_id: string;
  survivor_entity_id: string;
  restored_entity_id: string;
  survivor_revision_after: number;
  restored_revision_after: number;
  reason_code: EntityMergeReversalDecision["reasonCode"];
  created_at: Date | string;
};

function mapEntity(row: EntityRow): Entity {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.entity_type,
    status: row.status,
    canonicalLabel: row.canonical_label,
    aliases: Object.freeze(
      row.aliases.map((alias) =>
        Object.freeze({
          id: alias.id,
          label: alias.label,
          createdAt: new Date(alias.createdAt).toISOString(),
        }),
      ),
    ),
    mergedInto: row.merged_into_id
      ? Object.freeze({
          type: "ENTITY" as const,
          id: row.merged_into_id,
          workspaceId: row.workspace_id,
        })
      : null,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function mapEntityMerge(row: EntityMergeRow): EntityMergeDecision {
  return Object.freeze({
    id: row.id,
    operationId: row.operation_id,
    workspaceId: row.workspace_id,
    survivorEntityId: row.survivor_entity_id,
    absorbedEntityId: row.absorbed_entity_id,
    survivorRevision: row.survivor_revision_after,
    absorbedRevision: row.absorbed_revision_after,
    reasonCode: row.reason_code,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

function mapEntityMergeReversal(
  row: EntityMergeReversalRow,
): EntityMergeReversalDecision {
  return Object.freeze({
    id: row.id,
    operationId: row.operation_id,
    entityMergeId: row.merge_id,
    workspaceId: row.workspace_id,
    survivorEntityId: row.survivor_entity_id,
    restoredEntityId: row.restored_entity_id,
    survivorRevision: row.survivor_revision_after,
    restoredEntityRevision: row.restored_revision_after,
    reasonCode: row.reason_code,
    createdAt: new Date(row.created_at).toISOString(),
  });
}

function conflict(): never {
  throw new AppError({
    code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
    message: "Idempotency-Key was already used with a different request.",
    statusCode: 409,
  });
}

function operationConflict(): never {
  throw new AppError({
    code: "ENTITY_MERGE_OPERATION_CONFLICT",
    message: "The audit operation ID was already used for another Entity merge.",
    statusCode: 409,
  });
}

function reverseOperationConflict(): never {
  throw new AppError({
    code: "ENTITY_MERGE_REVERSE_OPERATION_CONFLICT",
    message: "The audit operation ID was already used for another merge reversal.",
    statusCode: 409,
  });
}

function entityMergeNotFound(): never {
  throw new AppError({
    code: "ENTITY_MERGE_NOT_FOUND",
    message: "Entity merge was not found.",
    statusCode: 404,
  });
}

function alreadyReversed(): never {
  throw new AppError({
    code: "ENTITY_MERGE_ALREADY_REVERSED",
    message: "Entity merge has already been reversed.",
    statusCode: 409,
  });
}

function mergeNotFound(): never {
  throw new AppError({
    code: "ENTITY_NOT_FOUND",
    message: "Entity was not found.",
    statusCode: 404,
  });
}

function revisionConflict(): never {
  throw new AppError({
    code: "CONFLICT_REVISION_MISMATCH",
    message: "The resource has changed since it was read.",
    statusCode: 412,
  });
}
