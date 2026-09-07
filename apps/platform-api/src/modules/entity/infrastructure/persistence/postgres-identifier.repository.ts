import { sql } from "drizzle-orm";
import { DatabaseContext, currentTransaction } from "@intelligence/database";
import type { DataClassification } from "@intelligence/contracts";
import { AppError } from "../../../../platform/errors/index.js";
import type { OutboxStore } from "../../../../platform/events/outbox/domain/outbox-store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import type {
  EntityIdentifier,
  IdentifierStatus,
  IdentifierType,
} from "../../domain/identifier.js";
import { normalizeCreateIdentifier } from "../../domain/identifier.js";
import type { IdentifierRepository } from "../../domain/identifier-repository.js";
import {
  sameFingerprint,
  type IdentifierProtection,
  type ProtectedIdentifierValue,
} from "../security/identifier-protection.js";

export class PostgresIdentifierRepository implements IdentifierRepository {
  constructor(
    private readonly database: DatabaseContext,
    private readonly outbox: OutboxStore,
    private readonly protection: IdentifierProtection,
  ) {}

  async create(command: Parameters<IdentifierRepository["create"]>[0]) {
    this.requireTransaction();
    const normalized = normalizeCreateIdentifier(command);
    const db = this.database.connection();
    const lock = `identifier-create:${command.actorUserId}:${command.idempotencyKey}`;
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
    const entity = await db.execute(sql`SELECT id FROM entities
      WHERE id = ${command.entityId} AND workspace_id = ${command.workspaceId}
        AND status = 'ACTIVE' FOR UPDATE`);
    if (!entity.rows.length) notFound();

    const requestedFingerprint = this.protection.fingerprint(
      command.workspaceId,
      normalized.type,
      normalized.value,
    );
    const replay =
      await db.execute(sql`SELECT identifier_id FROM entity_identifier_idempotency
      WHERE user_id = ${command.actorUserId}
        AND idempotency_key = ${command.idempotencyKey}`);
    const replayId = (replay.rows[0] as { identifier_id: string } | undefined)
      ?.identifier_id;
    if (replayId) {
      const existing = await this.findStored(replayId);
      if (
        !existing ||
        existing.metadata.entityId !== command.entityId ||
        existing.metadata.workspaceId !== command.workspaceId ||
        existing.metadata.type !== normalized.type ||
        existing.metadata.classification !== normalized.classification ||
        existing.protectedValue.fingerprintKeyId !== requestedFingerprint.keyId ||
        !sameFingerprint(
          existing.protectedValue.comparisonFingerprint,
          requestedFingerprint.value,
        )
      )
        idempotencyConflict();
      return existing.metadata;
    }

    const count = await db.execute(sql`SELECT count(*)::int AS count
      FROM entity_identifiers WHERE entity_id = ${command.entityId}`);
    if (Number(count.rows[0]?.count) >= 100)
      throw new AppError({
        code: "IDENTIFIER_LIMIT_REACHED",
        message: "Entity Identifier limit has been reached.",
        statusCode: 409,
      });

    const now = new Date();
    const value: EntityIdentifier = Object.freeze({
      id: newUuid(),
      entityId: command.entityId,
      workspaceId: command.workspaceId,
      type: normalized.type,
      classification: normalized.classification,
      status: "ACTIVE",
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const protectedValue = this.protection.protect(value, normalized.value);
    try {
      await db.execute(sql`INSERT INTO entity_identifiers
        (id, entity_id, workspace_id, identifier_type, classification, status,
         encrypted_value, encryption_nonce, authentication_tag, encryption_key_id,
         cipher_algorithm, comparison_fingerprint, fingerprint_key_id,
         fingerprint_algorithm, normalization_version, revision,
         created_by_user_id, created_at, updated_at)
        VALUES (${value.id}, ${value.entityId}, ${value.workspaceId}, ${value.type},
          ${value.classification}, ${value.status}, ${protectedValue.ciphertext},
          ${protectedValue.nonce}, ${protectedValue.authenticationTag},
          ${protectedValue.encryptionKeyId}, ${protectedValue.cipherAlgorithm},
          ${protectedValue.comparisonFingerprint}, ${protectedValue.fingerprintKeyId},
          ${protectedValue.fingerprintAlgorithm}, ${protectedValue.normalizationVersion},
          1, ${command.actorUserId}, ${value.createdAt}, ${value.updatedAt})`);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new AppError({
          code: "IDENTIFIER_ALREADY_EXISTS",
          message: "Identifier already belongs to an Entity in this Workspace.",
          statusCode: 409,
        });
      throw error;
    }
    await db.execute(sql`INSERT INTO entity_identifier_revisions
      (identifier_id, revision, entity_id, workspace_id, identifier_type,
       classification, status, actor_user_id, occurred_at)
      VALUES (${value.id}, 1, ${value.entityId}, ${value.workspaceId}, ${value.type},
        ${value.classification}, ${value.status}, ${command.actorUserId}, ${now})`);
    await db.execute(sql`INSERT INTO entity_identifier_idempotency
      (user_id, idempotency_key, identifier_id, created_at)
      VALUES (${command.actorUserId}, ${command.idempotencyKey}, ${value.id}, ${now})`);
    await this.outbox.enqueue({
      type: "IDENTIFIER_CREATED",
      version: 1,
      aggregate: { type: "IDENTIFIER", id: value.id },
      payload: {
        identifierId: value.id,
        entityId: value.entityId,
        workspaceId: value.workspaceId,
        revision: value.revision,
      },
      occurredAt: now,
    });
    return value;
  }

  async find(id: string): Promise<EntityIdentifier | undefined> {
    return (await this.findStored(id))?.metadata;
  }

  async list(entityId: string, workspaceId: string): Promise<EntityIdentifier[]> {
    const result = await this.database.connection().execute(sql`SELECT
      id, entity_id, workspace_id, identifier_type, classification, status,
      revision, created_at, updated_at
      FROM entity_identifiers
      WHERE entity_id = ${entityId} AND workspace_id = ${workspaceId}
      ORDER BY identifier_type, id LIMIT 100`);
    return (result.rows as IdentifierRow[]).map(mapIdentifier);
  }

  async reveal(id: string): Promise<string> {
    const stored = await this.findStored(id);
    if (!stored) notFound();
    return this.protection.reveal(stored.metadata, stored.protectedValue);
  }

  private async findStored(id: string) {
    const result = await this.database.connection().execute(sql`SELECT *
      FROM entity_identifiers WHERE id = ${id}`);
    const row = result.rows[0] as StoredIdentifierRow | undefined;
    if (!row) return undefined;
    return {
      metadata: mapIdentifier(row),
      protectedValue: {
        ciphertext: row.encrypted_value,
        nonce: row.encryption_nonce,
        authenticationTag: row.authentication_tag,
        encryptionKeyId: row.encryption_key_id,
        cipherAlgorithm: row.cipher_algorithm,
        comparisonFingerprint: row.comparison_fingerprint,
        fingerprintKeyId: row.fingerprint_key_id,
        fingerprintAlgorithm: row.fingerprint_algorithm,
        normalizationVersion: row.normalization_version,
      } as ProtectedIdentifierValue,
    };
  }

  private requireTransaction(): void {
    if (!currentTransaction())
      throw new Error("Identifier writes require a transaction.");
  }
}

type IdentifierRow = {
  id: string;
  entity_id: string;
  workspace_id: string;
  identifier_type: IdentifierType;
  classification: DataClassification;
  status: IdentifierStatus;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
};
type StoredIdentifierRow = IdentifierRow & {
  encrypted_value: Buffer;
  encryption_nonce: Buffer;
  authentication_tag: Buffer;
  encryption_key_id: string;
  cipher_algorithm: ProtectedIdentifierValue["cipherAlgorithm"];
  comparison_fingerprint: Buffer;
  fingerprint_key_id: string;
  fingerprint_algorithm: ProtectedIdentifierValue["fingerprintAlgorithm"];
  normalization_version: ProtectedIdentifierValue["normalizationVersion"];
};

function mapIdentifier(row: IdentifierRow): EntityIdentifier {
  return Object.freeze({
    id: row.id,
    entityId: row.entity_id,
    workspaceId: row.workspace_id,
    type: row.identifier_type,
    classification: row.classification,
    status: row.status,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
function notFound(): never {
  throw new AppError({
    code: "IDENTIFIER_NOT_FOUND",
    message: "Identifier was not found.",
    statusCode: 404,
  });
}
function idempotencyConflict(): never {
  throw new AppError({
    code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
    message: "Idempotency-Key was already used with a different request.",
    statusCode: 409,
  });
}
