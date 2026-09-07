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
  normalizeCreateEntity,
  renameEntity,
  type Entity,
  type EntityAlias,
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
    await this.database.connection().execute(sql`INSERT INTO entity_revisions
      (entity_id, revision, entity_type, status, canonical_label, merged_into_id,
       actor_user_id, occurred_at)
      VALUES (${value.id}, ${value.revision}, ${value.type}, ${value.status},
        ${value.canonicalLabel}, ${value.mergedInto?.id ?? null}, ${actorUserId},
        ${value.updatedAt})`);
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

function conflict(): never {
  throw new AppError({
    code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
    message: "Idempotency-Key was already used with a different request.",
    statusCode: 409,
  });
}
