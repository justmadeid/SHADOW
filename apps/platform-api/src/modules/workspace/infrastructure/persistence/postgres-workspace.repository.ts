import { sql } from "drizzle-orm";

import { DatabaseContext } from "@intelligence/database";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type {
  CreateWorkspaceCommand,
  CreateWorkspaceResult,
  WorkspaceRepository,
} from "../../domain/workspace-repository.js";
import type { Workspace } from "../../domain/workspace.js";
import {
  workspaceIdempotency,
  workspaceMembers,
  workspaceMembershipHistory,
  workspaceSettings,
  workspaces,
} from "./workspace.schema.js";

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  status: Workspace["status"];
  revision: number;
  locale: string;
  time_zone: string;
  created_at: Date;
  updated_at: Date;
};

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
  ) {}

  async createForUser(command: CreateWorkspaceCommand): Promise<CreateWorkspaceResult> {
    const connection = this.database.connection();
    const lockKey = `workspace-create:${command.userId}:${command.idempotencyKey}`;
    await connection.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );

    const replay = await connection.execute(sql`
      SELECT request_hash, workspace_id
      FROM workspace_idempotency
      WHERE user_id = ${command.userId}
        AND idempotency_key = ${command.idempotencyKey}
    `);
    const replayRow = replay.rows[0] as
      { request_hash: string; workspace_id: string } | undefined;

    if (replayRow) {
      if (replayRow.request_hash !== command.requestHash) {
        throw new AppError({
          code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
          message: "Idempotency-Key was already used with a different request.",
          statusCode: 409,
        });
      }

      const workspace = await this.findByIdForUser(
        replayRow.workspace_id,
        command.userId,
      );
      if (!workspace) {
        throw new Error("Workspace idempotency record references inaccessible data.");
      }
      return { workspace, replayed: true };
    }

    const now = new Date();
    const workspaceId = newUuid();
    const membershipId = newUuid();

    try {
      await connection.insert(workspaces).values({
        id: workspaceId,
        name: command.name,
        slug: command.slug,
        status: "ACTIVE",
        revision: 1,
        createdByUserId: command.userId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError({
          code: "WORKSPACE_SLUG_CONFLICT",
          message: "Workspace slug is already in use.",
          statusCode: 409,
        });
      }
      throw error;
    }

    await connection.insert(workspaceSettings).values({
      workspaceId,
      locale: command.locale,
      timeZone: command.timeZone,
    });
    await connection.insert(workspaceMembers).values({
      id: membershipId,
      workspaceId,
      userId: command.userId,
      status: "ACTIVE",
      revision: 1,
      joinedAt: now,
      removedAt: null,
    });
    await connection.insert(workspaceMembershipHistory).values({
      id: newUuid(),
      workspaceMemberId: membershipId,
      workspaceId,
      userId: command.userId,
      action: "ADDED",
      actorUserId: command.userId,
      reason: "WORKSPACE_CREATED",
      occurredAt: now,
    });
    await connection.insert(workspaceIdempotency).values({
      userId: command.userId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
      workspaceId,
      createdAt: now,
    });

    await this.outbox.enqueue({
      type: "WORKSPACE_CREATED",
      version: 1,
      aggregate: { type: "WORKSPACE", id: workspaceId },
      payload: { workspaceId, revision: 1 },
      occurredAt: now,
    });
    await this.outbox.enqueue({
      type: "WORKSPACE_MEMBERSHIP_CHANGED",
      version: 1,
      aggregate: { type: "WORKSPACE", id: workspaceId },
      payload: { workspaceId, membershipId, action: "ADDED", revision: 1 },
      occurredAt: now,
    });

    return {
      workspace: {
        id: workspaceId,
        name: command.name,
        slug: command.slug,
        status: "ACTIVE",
        settings: { locale: command.locale, timeZone: command.timeZone },
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
      replayed: false,
    };
  }

  async listForUser(userId: string, limit: number): Promise<Workspace[]> {
    const result = await this.database.connection().execute(sql`
      SELECT w.id, w.name, w.slug, w.status, w.revision,
             s.locale, s.time_zone, w.created_at, w.updated_at
      FROM workspaces w
      JOIN workspace_settings s ON s.workspace_id = w.id
      JOIN workspace_members m ON m.workspace_id = w.id
      WHERE m.user_id = ${userId} AND m.status = 'ACTIVE'
      ORDER BY w.created_at DESC, w.id DESC
      LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))}
    `);
    return (result.rows as WorkspaceRow[]).map(mapWorkspace);
  }

  async findByIdForUser(
    workspaceId: string,
    userId: string,
  ): Promise<Workspace | undefined> {
    const result = await this.database.connection().execute(sql`
      SELECT w.id, w.name, w.slug, w.status, w.revision,
             s.locale, s.time_zone, w.created_at, w.updated_at
      FROM workspaces w
      JOIN workspace_settings s ON s.workspace_id = w.id
      JOIN workspace_members m ON m.workspace_id = w.id
      WHERE w.id = ${workspaceId}
        AND m.user_id = ${userId}
        AND m.status = 'ACTIVE'
      LIMIT 1
    `);
    const row = result.rows[0] as WorkspaceRow | undefined;
    return row ? mapWorkspace(row) : undefined;
  }
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    settings: { locale: row.locale, timeZone: row.time_zone },
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "23505",
  );
}
