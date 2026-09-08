import fs from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AccessTokenVerifier } from "@intelligence/auth";
import { createDatabaseClient } from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Logger } from "pino";
import { EntityModule } from "../../entity.module.js";
import { EntityFacade } from "../../application/entity.facade.js";
import { WorkspaceFacade } from "../../../workspace/index.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { AuthenticationGuard } from "../../../../platform/auth/authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "../../../../platform/auth/authentication.tokens.js";
import { PlatformExceptionFilter } from "../../../../platform/errors/http-exception.filter.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import {
  AesGcmIdentifierProtection,
  IDENTIFIER_PROTECTION,
} from "../security/identifier-protection.js";

const verifier: AccessTokenVerifier = {
  async verify(token) {
    if (token === "worker")
      return {
        kind: "SERVICE",
        subject: token,
        serviceId: token,
        clientId: token,
        issuer: "https://identity.example.test",
      };
    if (!["owner", "viewer", "outsider"].includes(token))
      throw new Error("Invalid synthetic token");
    return {
      kind: "USER",
      subject: token,
      userId: token,
      issuer: "https://identity.example.test",
    };
  },
};
const body = {
  type: "PERSON",
  canonicalLabel: "Synthetic Person",
  aliases: ["Test Person"],
};

describe("P2-003/P2-011/P2-012 Entity Registry HTTP and PostgreSQL", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let context: RequestContextStore;
  let entities: EntityFacade;
  let workspaces: WorkspaceFacade;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../../../audit/infrastructure/persistence/migrations/0002_candidate_resolution_action.sql",
      "../../../audit/infrastructure/persistence/migrations/0003_entity_merge_action.sql",
      "../../../audit/infrastructure/persistence/migrations/0004_entity_merge_reverse_action.sql",
      "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "./migrations/0001_create_entity_registry.sql",
      "./migrations/0002_create_secure_identifiers.sql",
      "./migrations/0003_entity_merge_baseline.sql",
      "./migrations/0004_entity_merge_reversal.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );
    const module = await Test.createTestingModule({
      imports: [EntityModule],
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        AuthenticationGuard,
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
      ],
    })
      .overrideProvider(PLATFORM_DB_CLIENT)
      .useValue(client)
      .overrideProvider(IDENTIFIER_PROTECTION)
      .useValue(
        new AesGcmIdentifierProtection(
          { keyId: "test-encryption-v1", key: Buffer.alloc(32, 1) },
          { keyId: "test-fingerprint-v1", key: Buffer.alloc(32, 2) },
        ),
      )
      .compile();
    context = module.get(RequestContextStore);
    entities = module.get(EntityFacade);
    workspaces = module.get(WorkspaceFacade);
    app = module.createNestApplication();
    app.useGlobalFilters(
      new PlatformExceptionFilter(context, { error: vi.fn() } as unknown as Logger),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await client?.pool.end();
    await started?.container.stop();
  });

  it("creates one thin Entity across replay and emits metadata-only Outbox", async () => {
    const workspace = await fixture();
    const key = newUuid();
    const first = await create(workspace.id, key).expect(201);
    const replay = await create(workspace.id, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({
      workspaceId: workspace.id,
      type: "PERSON",
      status: "ACTIVE",
      canonicalLabel: "Synthetic Person",
      mergedInto: null,
      revision: 1,
    });
    expect(first.body.aliases).toHaveLength(1);
    expect(first.headers.etag).toBe('"1"');
    expect((await get(`/entities/${first.body.id}`).expect(200)).body).toEqual(
      first.body,
    );
    const page = await get(`/workspaces/${workspace.id}/entities`).expect(200);
    expect(page.body.items).toHaveLength(1);
    const event = await client.db.execute(
      sql`SELECT payload FROM platform_outbox_events WHERE aggregate_id = ${first.body.id}`,
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]?.payload).toMatchObject({
      entityId: first.body.id,
      workspaceId: workspace.id,
      revision: 1,
    });
    expect(JSON.stringify(event.rows)).not.toContain("Synthetic Person");
    expect(JSON.stringify(event.rows)).not.toContain("Test Person");
    await create(workspace.id, key, { ...body, canonicalLabel: "Different" }).expect(409);
    const other = await fixture();
    await create(other.id, key).expect(409);
  });

  it("renames non-destructively, adds aliases and enforces revision/status", async () => {
    const workspace = await fixture();
    const value = (await create(workspace.id).expect(201)).body;
    const renamed = await patch(
      value.id,
      { canonicalLabel: "Canonical Person" },
      1,
    ).expect(200);
    expect(renamed.body.aliases.map((alias: { label: string }) => alias.label)).toContain(
      "Synthetic Person",
    );
    const added = await patch(value.id, { alias: "S. Person" }, 2).expect(200);
    expect(added.body.revision).toBe(3);
    await patch(value.id, { alias: "Stale" }, 2).expect(412);
    await patch(value.id, { alias: "canonical person" }, 3).expect(409);
    const archived = await patch(value.id, { status: "ARCHIVED" }, 3).expect(200);
    expect(archived.body).toMatchObject({ status: "ARCHIVED", revision: 4 });
    await patch(value.id, { canonicalLabel: "Too Late" }, 4).expect(409);
    expect(await entities.resolve(workspace.id, value.id)).toBeNull();

    const history = await client.db.execute(
      sql`SELECT revision, canonical_label, status FROM entity_revisions WHERE entity_id = ${value.id} ORDER BY revision`,
    );
    expect(history.rows).toHaveLength(4);
    await expect(
      client.db.execute(
        sql`UPDATE entity_revisions SET canonical_label = 'mutated' WHERE entity_id = ${value.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      client.db.execute(sql`DELETE FROM entity_aliases WHERE entity_id = ${value.id}`),
    ).rejects.toThrow();
  });

  it("keeps the aggregate identity-only and rejects premature merge", async () => {
    const workspace = await fixture();
    for (const extra of [
      { workspaceId: workspace.id },
      { caseId: newUuid() },
      { allegation: "untrusted" },
      { identifiers: [{ type: "NATIONAL_ID", value: "untrusted" }] },
      { status: "ACTIVE" },
      { mergedInto: null },
      { employer: "untrusted" },
    ])
      await create(workspace.id, newUuid(), { ...body, ...extra }).expect(400);
    const value = (await create(workspace.id).expect(201)).body;
    for (const changes of [
      {},
      { status: "MERGED" },
      { type: "ORGANIZATION" },
      { alias: "A", canonicalLabel: "B" },
      { identifiers: [] },
      { caseId: newUuid() },
    ])
      await patch(value.id, changes, 1).expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspace.id}/entities`)
      .set("authorization", "Bearer owner")
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/entities/${value.id}`)
      .set("authorization", "Bearer owner")
      .send({ alias: "Missing revision" })
      .expect(400);
  });

  it("separates Workspace view/manage grants and rechecks membership", async () => {
    const workspace = await fixture();
    const value = (await create(workspace.id).expect(201)).body;
    await get(`/entities/${value.id}`, "viewer").expect(200);
    await get(`/workspaces/${workspace.id}/entities`, "viewer").expect(200);
    await create(workspace.id, newUuid(), body, "viewer").expect(403);
    await patch(value.id, { alias: "Denied" }, 1, "viewer").expect(404);
    for (const user of ["outsider"]) {
      await get(`/entities/${value.id}`, user).expect(404);
      await get(`/workspaces/${workspace.id}/entities`, user).expect(404);
    }
    await get(`/entities/${value.id}`, "worker").expect(403);
    await request(app.getHttpServer()).get(`/api/v1/entities/${value.id}`).expect(401);
    await client.db.execute(
      sql`UPDATE workspace_members SET status = 'REMOVED' WHERE workspace_id = ${workspace.id} AND user_id = 'viewer'`,
    );
    await get(`/entities/${value.id}`, "viewer").expect(404);
  });

  it("paginates stable Workspace IDs and rejects cross-Workspace cursors", async () => {
    const workspace = await fixture();
    const first = (await create(workspace.id).expect(201)).body;
    await create(workspace.id, newUuid(), {
      ...body,
      canonicalLabel: "Second Entity",
    }).expect(201);
    const page = await get(`/workspaces/${workspace.id}/entities?limit=1`).expect(200);
    expect(page.body).toMatchObject({ page: { hasMore: true } });
    const second = await get(
      `/workspaces/${workspace.id}/entities?limit=1&cursor=${page.body.page.nextCursor}`,
    ).expect(200);
    expect(second.body.items[0].id).toBe(first.id);
    const other = await fixture();
    await get(
      `/workspaces/${other.id}/entities?cursor=${page.body.page.nextCursor}`,
    ).expect(400);
    await get(`/workspaces/${workspace.id}/entities?limit=101`).expect(400);
    await get(`/workspaces/${workspace.id}/entities?caseId=${newUuid()}`).expect(400);
  });

  it("rolls back Entity, aliases, replay and history when Outbox fails", async () => {
    const workspace = await fixture();
    const key = newUuid();
    const tables = [
      "entities",
      "entity_aliases",
      "entity_revisions",
      "entity_idempotency",
    ];
    const before = new Map<string, number>();
    for (const table of tables) {
      const rows = await client.db.execute(
        sql.raw(`SELECT count(*)::int AS count FROM ${table}`),
      );
      before.set(table, Number(rows.rows[0]?.count));
    }
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_entity_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'ENTITY_CREATED' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_entity_event BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_entity_event();`,
      ),
    );
    try {
      const failed = await create(workspace.id, key).expect(500);
      expect(JSON.stringify(failed.body)).not.toContain("synthetic-private");
      for (const table of tables) {
        const rows = await client.db.execute(
          sql.raw(`SELECT count(*)::int AS count FROM ${table}`),
        );
        expect(Number(rows.rows[0]?.count)).toBe(before.get(table));
      }
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_entity_event ON platform_outbox_events; DROP FUNCTION fail_entity_event();",
        ),
      );
    }
    await create(workspace.id, key).expect(201);
  });

  it("resolves only active canonical Entities in the requested Workspace", async () => {
    const workspace = await fixture();
    const other = await fixture();
    const value = (await create(workspace.id).expect(201)).body;
    const legacy = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Legacy Entity ID",
      }).expect(201)
    ).body;
    await expect(entities.resolve(workspace.id, value.id)).resolves.toMatchObject({
      id: value.id,
      workspaceId: workspace.id,
      type: "PERSON",
      status: "ACTIVE",
    });
    await expect(entities.resolve(other.id, value.id)).resolves.toBeNull();
    await expect(entities.resolve(workspace.id, newUuid())).resolves.toBeNull();
    await client.db.execute(sql`UPDATE entities
      SET status = 'MERGED', merged_into_id = ${value.id}, revision = revision + 1
      WHERE id = ${legacy.id}`);
    await expect(entities.resolve(workspace.id, legacy.id)).resolves.toMatchObject({
      id: value.id,
      status: "ACTIVE",
    });
  });

  it("merges into an explicit survivor with immutable history, audit and idempotency", async () => {
    const workspace = await fixture();
    const survivor = (await create(workspace.id).expect(201)).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Synthetic Duplicate",
      }).expect(201)
    ).body;
    const key = newUuid();
    const operationId = newUuid();
    const input = {
      absorbedEntityId: absorbed.id,
      absorbedRevision: absorbed.revision,
      reasonCode: "DUPLICATE_IDENTITY",
    };
    const first = await merge(
      survivor.id,
      input,
      survivor.revision,
      key,
      operationId,
    ).expect(201);
    const replay = await merge(
      survivor.id,
      input,
      survivor.revision,
      key,
      operationId,
    ).expect(201);
    expect(replay.body).toEqual(first.body);
    expect(first.headers.etag).toBe('"2"');
    expect(first.body).toMatchObject({
      operationId,
      workspaceId: workspace.id,
      survivorEntityId: survivor.id,
      absorbedEntityId: absorbed.id,
      survivorRevision: 2,
      absorbedRevision: 2,
      reasonCode: "DUPLICATE_IDENTITY",
    });
    expect((await get(`/entities/${survivor.id}`).expect(200)).body).toMatchObject({
      status: "ACTIVE",
      revision: 2,
      mergedInto: null,
    });
    expect((await get(`/entities/${absorbed.id}`).expect(200)).body).toMatchObject({
      status: "MERGED",
      revision: 2,
      mergedInto: { id: survivor.id, workspaceId: workspace.id },
    });
    await expect(entities.resolve(workspace.id, absorbed.id)).resolves.toMatchObject({
      id: survivor.id,
      revision: 2,
    });

    const persisted = await client.db.execute(sql`SELECT m.*, a.action, a.outcome,
      a.reason, a.resource_id, a.resource_revision
      FROM entity_merges m JOIN audit_events a ON a.operation_id = m.operation_id
      WHERE m.id = ${first.body.id}`);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      survivor_entity_id: survivor.id,
      absorbed_entity_id: absorbed.id,
      actor_user_id: "owner",
      action: "ENTITY_MERGE",
      outcome: "AUTHORIZED",
      reason: "DUPLICATE_IDENTITY",
      resource_id: absorbed.id,
      resource_revision: 2,
    });
    const revisions = await client.db.execute(sql`SELECT entity_id, revision, status,
      merged_into_id FROM entity_revisions
      WHERE entity_id IN (${survivor.id}, ${absorbed.id}) ORDER BY entity_id, revision`);
    expect(revisions.rows).toHaveLength(4);
    const events = await client.db.execute(sql`SELECT aggregate_type, payload
      FROM platform_outbox_events WHERE event_type = 'ENTITY_MERGED'
        AND aggregate_id = ${first.body.id}`);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      aggregate_type: "ENTITY_MERGE",
      payload: {
        entityMergeId: first.body.id,
        survivorEntityId: survivor.id,
        absorbedEntityId: absorbed.id,
      },
    });
    expect(JSON.stringify(events.rows)).not.toContain("Synthetic");
    await expect(
      client.db.execute(sql`UPDATE entity_merges SET reason_code = 'MANUAL_REVIEW'
        WHERE id = ${first.body.id}`),
    ).rejects.toThrow();
    await merge(
      survivor.id,
      { ...input, reasonCode: "MANUAL_REVIEW" },
      survivor.revision,
      key,
      operationId,
    ).expect(409);
    const otherSurvivor = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Other Survivor",
      }).expect(201)
    ).body;
    const otherAbsorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Other Duplicate",
      }).expect(201)
    ).body;
    await merge(
      otherSurvivor.id,
      {
        absorbedEntityId: otherAbsorbed.id,
        absorbedRevision: 1,
        reasonCode: "MANUAL_REVIEW",
      },
      1,
      newUuid(),
      operationId,
    ).expect(409);
  });

  it("rejects unsafe merge scope, lifecycle, concurrency and principals", async () => {
    const workspace = await fixture();
    const survivor = (await create(workspace.id).expect(201)).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Merge Candidate",
      }).expect(201)
    ).body;
    const organization = (
      await create(workspace.id, newUuid(), {
        type: "ORGANIZATION",
        canonicalLabel: "Synthetic Organization",
      }).expect(201)
    ).body;
    const otherWorkspace = await fixture();
    const foreign = (await create(otherWorkspace.id).expect(201)).body;
    const command = (absorbedEntityId: string, absorbedRevision = 1) => ({
      absorbedEntityId,
      absorbedRevision,
      reasonCode: "MANUAL_REVIEW",
    });
    await merge(survivor.id, command(survivor.id), 1).expect(409);
    await merge(survivor.id, command(organization.id), 1).expect(409);
    await merge(survivor.id, command(foreign.id), 1).expect(404);
    await merge(survivor.id, command(absorbed.id), 2).expect(412);
    await merge(survivor.id, command(absorbed.id, 2), 1).expect(412);
    await merge(
      survivor.id,
      command(absorbed.id),
      1,
      newUuid(),
      newUuid(),
      "viewer",
    ).expect(404);
    await merge(
      survivor.id,
      command(absorbed.id),
      1,
      newUuid(),
      newUuid(),
      "worker",
    ).expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/entities/${survivor.id}/actions/merge`)
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .set("x-audit-operation-id", newUuid())
      .send(command(absorbed.id))
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/entities/${survivor.id}/actions/merge`)
      .set("authorization", "Bearer owner")
      .send(command(absorbed.id))
      .expect(400);

    await merge(survivor.id, command(absorbed.id), 1).expect(201);
    const third = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Third Identity",
      }).expect(201)
    ).body;
    await merge(third.id, command(absorbed.id, 2), 1).expect(409);
  });

  it("serializes concurrent merge decisions for the same absorbed Entity", async () => {
    const workspace = await fixture();
    const firstSurvivor = (await create(workspace.id).expect(201)).body;
    const secondSurvivor = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Concurrent Survivor",
      }).expect(201)
    ).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Concurrent Duplicate",
      }).expect(201)
    ).body;
    const command = {
      absorbedEntityId: absorbed.id,
      absorbedRevision: 1,
      reasonCode: "MANUAL_REVIEW",
    };
    const attempts = await Promise.all([
      merge(firstSurvivor.id, command, 1),
      merge(secondSurvivor.id, command, 1),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 412]);
    const winner = attempts.find((attempt) => attempt.status === 201)!;
    expect((await get(`/entities/${absorbed.id}`).expect(200)).body).toMatchObject({
      status: "MERGED",
      mergedInto: {
        id: winner.body.survivorEntityId,
        workspaceId: workspace.id,
      },
    });
    const decisions = await client.db.execute(sql`SELECT id FROM entity_merges
      WHERE absorbed_entity_id = ${absorbed.id}`);
    expect(decisions.rows).toHaveLength(1);
  });

  it("fails merge closed when critical Audit cannot commit", async () => {
    const workspace = await fixture();
    const survivor = (await create(workspace.id).expect(201)).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Rollback Duplicate",
      }).expect(201)
    ).body;
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_entity_merge_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'ENTITY_MERGE' THEN RAISE EXCEPTION 'synthetic-private-audit-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_entity_merge_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_entity_merge_audit();`,
      ),
    );
    try {
      const failed = await merge(
        survivor.id,
        {
          absorbedEntityId: absorbed.id,
          absorbedRevision: 1,
          reasonCode: "DATA_CORRECTION",
        },
        1,
      ).expect(503);
      expect(JSON.stringify(failed.body)).not.toContain("synthetic-private");
      expect((await get(`/entities/${survivor.id}`).expect(200)).body.revision).toBe(1);
      expect((await get(`/entities/${absorbed.id}`).expect(200)).body).toMatchObject({
        status: "ACTIVE",
        revision: 1,
        mergedInto: null,
      });
      expect(
        (
          await client.db.execute(sql`SELECT id FROM entity_merges
          WHERE absorbed_entity_id = ${absorbed.id}`)
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.db.execute(sql`SELECT id FROM platform_outbox_events
          WHERE event_type = 'ENTITY_MERGED' AND payload->>'absorbedEntityId' = ${absorbed.id}`)
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_entity_merge_audit ON audit_events; DROP FUNCTION fail_entity_merge_audit();",
        ),
      );
    }
  });

  it("keeps canonical resolution bounded by rejecting an over-deep merge chain", async () => {
    const workspace = await fixture();
    const oldest = (await create(workspace.id).expect(201)).body;
    let absorbed = oldest;
    for (let depth = 1; depth <= 15; depth += 1) {
      const survivor = (
        await create(workspace.id, newUuid(), {
          ...body,
          canonicalLabel: `Chain Survivor ${depth}`,
        }).expect(201)
      ).body;
      await merge(
        survivor.id,
        {
          absorbedEntityId: absorbed.id,
          absorbedRevision: absorbed.revision,
          reasonCode: "DATA_CORRECTION",
        },
        survivor.revision,
      ).expect(201);
      absorbed = { ...survivor, revision: 2 };
    }
    await expect(entities.resolve(workspace.id, oldest.id)).resolves.toMatchObject({
      id: absorbed.id,
      status: "ACTIVE",
    });
    const unsupportedSurvivor = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Unsupported Chain Survivor",
      }).expect(201)
    ).body;
    await merge(
      unsupportedSurvivor.id,
      {
        absorbedEntityId: absorbed.id,
        absorbedRevision: absorbed.revision,
        reasonCode: "DATA_CORRECTION",
      },
      unsupportedSurvivor.revision,
    ).expect(409);
    expect((await get(`/entities/${absorbed.id}`).expect(200)).body).toMatchObject({
      status: "ACTIVE",
      revision: 2,
    });
  });

  it("reverses a merge with immutable history, audit and exact replay", async () => {
    const workspace = await fixture();
    const survivor = (await create(workspace.id).expect(201)).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Reversal Candidate",
      }).expect(201)
    ).body;
    const mergeDecision = (
      await merge(
        survivor.id,
        {
          absorbedEntityId: absorbed.id,
          absorbedRevision: 1,
          reasonCode: "DUPLICATE_IDENTITY",
        },
        1,
      ).expect(201)
    ).body;
    const key = newUuid();
    const operationId = newUuid();
    const input = {
      survivorRevision: 2,
      absorbedRevision: 2,
      reasonCode: "INCORRECT_IDENTITY_MATCH",
    };
    const first = await reverseMerge(mergeDecision.id, input, key, operationId).expect(
      201,
    );
    const replay = await reverseMerge(mergeDecision.id, input, key, operationId).expect(
      201,
    );
    expect(replay.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      operationId,
      entityMergeId: mergeDecision.id,
      workspaceId: workspace.id,
      survivorEntityId: survivor.id,
      restoredEntityId: absorbed.id,
      survivorRevision: 3,
      restoredEntityRevision: 3,
      reasonCode: "INCORRECT_IDENTITY_MATCH",
    });
    expect((await get(`/entities/${survivor.id}`).expect(200)).body).toMatchObject({
      status: "ACTIVE",
      revision: 3,
    });
    expect((await get(`/entities/${absorbed.id}`).expect(200)).body).toMatchObject({
      status: "ACTIVE",
      revision: 3,
      mergedInto: null,
    });
    await expect(entities.resolve(workspace.id, absorbed.id)).resolves.toMatchObject({
      id: absorbed.id,
      revision: 3,
    });

    const persisted = await client.db.execute(sql`SELECT r.*, a.action, a.outcome,
      a.reason, a.resource_id, a.resource_revision
      FROM entity_merge_reversals r
      JOIN audit_events a ON a.operation_id = r.operation_id
      WHERE r.id = ${first.body.id}`);
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      merge_id: mergeDecision.id,
      survivor_entity_id: survivor.id,
      restored_entity_id: absorbed.id,
      actor_user_id: "owner",
      action: "ENTITY_MERGE_REVERSE",
      outcome: "AUTHORIZED",
      reason: "INCORRECT_IDENTITY_MATCH",
      resource_id: absorbed.id,
      resource_revision: 3,
    });
    expect(
      (
        await client.db.execute(sql`SELECT id FROM entity_merges
          WHERE id = ${mergeDecision.id}`)
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.db.execute(sql`SELECT entity_id, revision FROM entity_revisions
          WHERE entity_id IN (${survivor.id}, ${absorbed.id})`)
      ).rows,
    ).toHaveLength(6);
    const events = await client.db.execute(sql`SELECT aggregate_type, payload
      FROM platform_outbox_events WHERE event_type = 'ENTITY_MERGE_REVERSED'
        AND aggregate_id = ${first.body.id}`);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      aggregate_type: "ENTITY_MERGE_REVERSAL",
      payload: {
        entityMergeId: mergeDecision.id,
        restoredEntityId: absorbed.id,
      },
    });
    expect(JSON.stringify(events.rows)).not.toContain("Reversal Candidate");
    await expect(
      client.db.execute(sql`UPDATE entity_merge_reversals
        SET reason_code = 'MANUAL_REVIEW' WHERE id = ${first.body.id}`),
    ).rejects.toThrow();
    await reverseMerge(
      mergeDecision.id,
      { ...input, reasonCode: "MANUAL_REVIEW" },
      key,
      operationId,
    ).expect(409);

    const secondSurvivor = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Second Reversal Survivor",
      }).expect(201)
    ).body;
    const secondAbsorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Second Reversal Candidate",
      }).expect(201)
    ).body;
    const secondMerge = (
      await merge(
        secondSurvivor.id,
        {
          absorbedEntityId: secondAbsorbed.id,
          absorbedRevision: 1,
          reasonCode: "MANUAL_REVIEW",
        },
        1,
      ).expect(201)
    ).body;
    await reverseMerge(
      secondMerge.id,
      {
        survivorRevision: 2,
        absorbedRevision: 2,
        reasonCode: "DATA_CORRECTION",
      },
      newUuid(),
      operationId,
    ).expect(409);
  });

  it("rejects unsafe merge reversal scope, state, revisions and principals", async () => {
    const workspace = await fixture();
    const survivor = (await create(workspace.id).expect(201)).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Unsafe Reversal Candidate",
      }).expect(201)
    ).body;
    const mergeDecision = (
      await merge(
        survivor.id,
        {
          absorbedEntityId: absorbed.id,
          absorbedRevision: 1,
          reasonCode: "MANUAL_REVIEW",
        },
        1,
      ).expect(201)
    ).body;
    const input = (survivorRevision = 2, absorbedRevision = 2) => ({
      survivorRevision,
      absorbedRevision,
      reasonCode: "DATA_CORRECTION",
    });
    await reverseMerge(newUuid(), input()).expect(404);
    await reverseMerge(mergeDecision.id, input(1, 2)).expect(412);
    await reverseMerge(mergeDecision.id, input(2, 1)).expect(412);
    await reverseMerge(mergeDecision.id, input(), newUuid(), newUuid(), "viewer").expect(
      404,
    );
    await reverseMerge(mergeDecision.id, input(), newUuid(), newUuid(), "worker").expect(
      403,
    );
    await request(app.getHttpServer())
      .post(`/api/v1/entity-merges/${mergeDecision.id}/actions/reverse`)
      .set("idempotency-key", newUuid())
      .set("x-audit-operation-id", newUuid())
      .send(input())
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/entity-merges/${mergeDecision.id}/actions/reverse`)
      .set("authorization", "Bearer owner")
      .send(input())
      .expect(400);
    await reverseMerge(mergeDecision.id, input()).expect(201);
    await reverseMerge(mergeDecision.id, input(3, 3)).expect(409);
  });

  it("serializes concurrent reversals of one merge decision", async () => {
    const workspace = await fixture();
    const survivor = (await create(workspace.id).expect(201)).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Concurrent Reversal Candidate",
      }).expect(201)
    ).body;
    const mergeDecision = (
      await merge(
        survivor.id,
        {
          absorbedEntityId: absorbed.id,
          absorbedRevision: 1,
          reasonCode: "MANUAL_REVIEW",
        },
        1,
      ).expect(201)
    ).body;
    const command = {
      survivorRevision: 2,
      absorbedRevision: 2,
      reasonCode: "WRONG_SURVIVOR_SELECTED",
    };
    const attempts = await Promise.all([
      reverseMerge(mergeDecision.id, command),
      reverseMerge(mergeDecision.id, command),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 409]);
    expect(
      (
        await client.db.execute(sql`SELECT id FROM entity_merge_reversals
          WHERE merge_id = ${mergeDecision.id}`)
      ).rows,
    ).toHaveLength(1);
  });

  it("rolls back merge reversal when critical Audit cannot commit", async () => {
    const workspace = await fixture();
    const survivor = (await create(workspace.id).expect(201)).body;
    const absorbed = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Reversal Rollback Candidate",
      }).expect(201)
    ).body;
    const mergeDecision = (
      await merge(
        survivor.id,
        {
          absorbedEntityId: absorbed.id,
          absorbedRevision: 1,
          reasonCode: "MANUAL_REVIEW",
        },
        1,
      ).expect(201)
    ).body;
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_entity_merge_reverse_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'ENTITY_MERGE_REVERSE' THEN RAISE EXCEPTION 'synthetic-private-reverse-audit-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_entity_merge_reverse_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_entity_merge_reverse_audit();`,
      ),
    );
    try {
      const failed = await reverseMerge(mergeDecision.id, {
        survivorRevision: 2,
        absorbedRevision: 2,
        reasonCode: "INSUFFICIENT_EVIDENCE",
      }).expect(503);
      expect(JSON.stringify(failed.body)).not.toContain("synthetic-private");
      expect((await get(`/entities/${survivor.id}`).expect(200)).body.revision).toBe(2);
      expect((await get(`/entities/${absorbed.id}`).expect(200)).body).toMatchObject({
        status: "MERGED",
        revision: 2,
        mergedInto: { id: survivor.id },
      });
      expect(
        (
          await client.db.execute(sql`SELECT id FROM entity_merge_reversals
            WHERE merge_id = ${mergeDecision.id}`)
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.db.execute(sql`SELECT id FROM platform_outbox_events
            WHERE event_type = 'ENTITY_MERGE_REVERSED'
              AND payload->>'entityMergeId' = ${mergeDecision.id}`)
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_entity_merge_reverse_audit ON audit_events; DROP FUNCTION fail_entity_merge_reverse_audit();",
        ),
      );
    }
  });

  it("encrypts identifier values and stores only keyed comparison fingerprints", async () => {
    const workspace = await fixture();
    const entity = (await create(workspace.id).expect(201)).body;
    const key = newUuid();
    const rawValue = "3201 0101-0101 0001";
    const first = await createIdentifier(entity.id, key, {
      type: "NATIONAL_ID",
      value: rawValue,
      classification: "RESTRICTED",
    }).expect(201);
    expect(first.body).toMatchObject({
      entityId: entity.id,
      workspaceId: workspace.id,
      type: "NATIONAL_ID",
      classification: "RESTRICTED",
      status: "ACTIVE",
      visibility: "MASKED",
      displayValue: "••••",
    });
    expect(JSON.stringify(first.body)).not.toContain("3201");
    expect(first.headers["cache-control"]).toBe("private, no-store");
    const replay = await createIdentifier(entity.id, key, {
      type: "NATIONAL_ID",
      value: rawValue,
      classification: "RESTRICTED",
    }).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await createIdentifier(entity.id, key, {
      type: "NATIONAL_ID",
      value: "3201010101010002",
      classification: "RESTRICTED",
    }).expect(409);

    const stored = await client.db.execute(sql`SELECT encrypted_value,
      comparison_fingerprint, encryption_key_id, fingerprint_key_id,
      cipher_algorithm, fingerprint_algorithm
      FROM entity_identifiers WHERE id = ${first.body.id}`);
    expect(stored.rows).toHaveLength(1);
    const row = stored.rows[0] as {
      encrypted_value: Buffer;
      comparison_fingerprint: Buffer;
      encryption_key_id: string;
      fingerprint_key_id: string;
      cipher_algorithm: string;
      fingerprint_algorithm: string;
    };
    expect(row.encrypted_value.toString("utf8")).not.toContain("3201010101010001");
    expect(
      row.comparison_fingerprint.equals(
        createHash("sha256").update("3201010101010001").digest(),
      ),
    ).toBe(false);
    expect(row).toMatchObject({
      encryption_key_id: "test-encryption-v1",
      fingerprint_key_id: "test-fingerprint-v1",
      cipher_algorithm: "aes-256-gcm",
      fingerprint_algorithm: "HMAC-SHA-256",
    });
    const listed = await get(`/entities/${entity.id}/identifiers`).expect(200);
    expect(listed.body.items).toEqual([first.body]);
    expect(JSON.stringify(listed.body)).not.toContain("3201");
    await get(`/entities/${entity.id}/identifiers`, "viewer").expect(200);
    await createIdentifier(
      entity.id,
      newUuid(),
      {
        type: "USERNAME",
        value: "denied_viewer",
        classification: "SENSITIVE",
      },
      "viewer",
    ).expect(404);
    await get(`/entities/${entity.id}/identifiers`, "outsider").expect(404);
    await get(`/entities/${entity.id}/identifiers`, "worker").expect(403);
    const event = await client.db.execute(
      sql`SELECT payload FROM platform_outbox_events WHERE aggregate_id = ${first.body.id}`,
    );
    expect(event.rows).toHaveLength(1);
    expect(JSON.stringify(event.rows)).not.toContain("3201");

    const other = (
      await create(workspace.id, newUuid(), {
        ...body,
        canonicalLabel: "Duplicate Candidate",
      }).expect(201)
    ).body;
    await createIdentifier(other.id, newUuid(), {
      type: "NATIONAL_ID",
      value: "3201010101010001",
      classification: "RESTRICTED",
    }).expect(409);
  });

  it("enforces masked, use-only and audited full-view field policy", async () => {
    const workspace = await fixture();
    const entity = (await create(workspace.id).expect(201)).body;
    const rawValue = "synthetic.person@example.test";
    const identifier = (
      await createIdentifier(entity.id, newUuid(), {
        type: "EMAIL",
        value: rawValue,
        classification: "RESTRICTED",
      }).expect(201)
    ).body;

    const masked = await get(`/identifiers/${identifier.id}`).expect(200);
    expect(masked.body).toMatchObject({
      visibility: "MASKED",
      displayValue: "••••",
    });
    expect(JSON.stringify(masked.body)).not.toContain(rawValue);
    expect(
      await client.db.execute(
        sql`SELECT id FROM audit_events WHERE resource_id = ${identifier.id}`,
      ),
    ).toMatchObject({ rows: [] });

    const useAssignment = await grantExtra(
      workspace.id,
      "owner",
      "IDENTIFIER_USE_RESTRICTED",
    );
    const useOperation = newUuid();
    const matchOnly = await get(`/identifiers/${identifier.id}`)
      .set("x-reason-for-access", "DUPLICATE_REVIEW")
      .set("x-audit-operation-id", useOperation)
      .expect(200);
    expect(matchOnly.body).toMatchObject({
      visibility: "MATCH_ONLY",
      matchStatus: "UNKNOWN",
    });
    expect(matchOnly.body).not.toHaveProperty("displayValue");
    await client.db.execute(sql`UPDATE governance_role_assignments
      SET status = 'REVOKED', revision = revision + 1, revoked_at = now()
      WHERE id = ${useAssignment}`);

    const viewAssignment = await grantExtra(
      workspace.id,
      "owner",
      "IDENTIFIER_VIEW_RESTRICTED",
    );
    const noReason = await get(`/identifiers/${identifier.id}`).expect(200);
    expect(noReason.body.visibility).toBe("MASKED");
    await get(`/identifiers/${identifier.id}`)
      .set("x-reason-for-access", "IDENTITY_VERIFICATION")
      .expect(400);
    const viewOperation = newUuid();
    const full = await get(`/identifiers/${identifier.id}`)
      .set("x-reason-for-access", "IDENTITY_VERIFICATION")
      .set("x-audit-operation-id", viewOperation)
      .expect(200);
    expect(full.body).toMatchObject({ visibility: "FULL", displayValue: rawValue });
    const audits = await client.db.execute(sql`SELECT operation_id, action, outcome,
      reason FROM audit_events WHERE resource_id = ${identifier.id} ORDER BY occurred_at`);
    expect(audits.rows).toEqual([
      {
        operation_id: useOperation,
        action: "SENSITIVE_FIELD_MATCH",
        outcome: "AUTHORIZED",
        reason: "DUPLICATE_REVIEW",
      },
      {
        operation_id: viewOperation,
        action: "SENSITIVE_FIELD_VIEW",
        outcome: "AUTHORIZED",
        reason: "IDENTITY_VERIFICATION",
      },
    ]);
    const auditEvents = await client.db.execute(sql`SELECT payload
      FROM platform_outbox_events WHERE event_type = 'AUDIT_EVENT_RECORDED'
        AND payload->>'workspaceId' = ${workspace.id}`);
    expect(JSON.stringify(auditEvents.rows)).not.toContain(rawValue);
    expect(JSON.stringify(auditEvents.rows)).not.toContain("IDENTITY_VERIFICATION");

    await client.db.execute(sql`UPDATE governance_role_assignments
      SET status = 'REVOKED', revision = revision + 1, revoked_at = now()
      WHERE id = ${viewAssignment}`);
    const revoked = await get(`/identifiers/${identifier.id}`)
      .set("x-reason-for-access", "IDENTITY_VERIFICATION")
      .set("x-audit-operation-id", newUuid())
      .expect(200);
    expect(revoked.body.visibility).toBe("MASKED");
    await get(`/identifiers/${identifier.id}`, "outsider").expect(404);
    await get(`/identifiers/${identifier.id}`, "worker").expect(403);
    await get(`/identifiers/${identifier.id}`)
      .set("x-audit-operation-id", "invalid")
      .expect(400);
    await get(`/identifiers/${identifier.id}`)
      .set("x-reason-for-access", rawValue)
      .expect(400);
  });

  it("protects immutable ciphertext/history and rolls back identifier writes with Outbox", async () => {
    const workspace = await fixture();
    const entity = (await create(workspace.id).expect(201)).body;
    const input = {
      type: "USERNAME",
      value: "synthetic_user",
      classification: "SENSITIVE",
    };
    const identifier = (await createIdentifier(entity.id, newUuid(), input).expect(201))
      .body;
    await expect(
      client.db
        .execute(sql`UPDATE entity_identifiers SET encrypted_value = ${Buffer.from("modified")}
        WHERE id = ${identifier.id}`),
    ).rejects.toThrow();
    await expect(
      client.db.execute(sql`DELETE FROM entity_identifier_revisions
        WHERE identifier_id = ${identifier.id}`),
    ).rejects.toThrow();

    const rollbackKey = newUuid();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_identifier_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'IDENTIFIER_CREATED' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_identifier_event BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_identifier_event();`,
      ),
    );
    try {
      const failed = await createIdentifier(entity.id, rollbackKey, {
        ...input,
        value: "another_synthetic_user",
      }).expect(500);
      expect(JSON.stringify(failed.body)).not.toContain("another_synthetic_user");
      const absent = await client.db.execute(sql`SELECT id FROM entity_identifiers
        WHERE entity_id = ${entity.id} AND id <> ${identifier.id}`);
      expect(absent.rows).toHaveLength(0);
      const replay = await client.db.execute(sql`SELECT identifier_id
        FROM entity_identifier_idempotency WHERE idempotency_key = ${rollbackKey}`);
      expect(replay.rows).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_identifier_event ON platform_outbox_events; DROP FUNCTION fail_identifier_event();",
        ),
      );
    }
    await createIdentifier(entity.id, rollbackKey, {
      ...input,
      value: "another_synthetic_user",
    }).expect(201);
  });

  async function fixture() {
    const workspace = await asUser(() =>
      workspaces.create(
        {
          name: "Synthetic Registry",
          slug: `registry-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
    );
    await client.db.execute(sql`INSERT INTO workspace_members
      (id, workspace_id, user_id, status, joined_at)
      VALUES (${newUuid()}, ${workspace.id}, 'viewer', 'ACTIVE', now())`);
    await grant(workspace.id, "owner", ["WORKSPACE_VIEW", "WORKSPACE_MANAGE"]);
    await grant(workspace.id, "viewer", ["WORKSPACE_VIEW"]);
    return workspace;
  }

  async function grant(workspaceId: string, userId: string, permissions: string[]) {
    const roleId = newUuid();
    await client.db.execute(sql`INSERT INTO governance_roles
      (id, workspace_id, key, name, status, revision, created_at, updated_at)
      VALUES (${roleId}, ${workspaceId}, ${`REGISTRY_${userId.toUpperCase()}`},
        'Registry synthetic role', 'ACTIVE', 1, now(), now())`);
    for (const permission of permissions)
      await client.db.execute(sql`INSERT INTO governance_role_permissions
        (role_id, permission) VALUES (${roleId}, ${permission})`);
    await client.db.execute(sql`INSERT INTO governance_role_assignments
      (id, workspace_id, role_id, subject_type, subject_id, scope_type,
       scope_resource_type, scope_resource_id, status, revision,
       granted_by_subject_type, granted_by_subject_id, granted_at, case_membership)
      VALUES (${newUuid()}, ${workspaceId}, ${roleId}, 'USER', ${userId},
        'WORKSPACE', null, null, 'ACTIVE', 1, 'USER', 'owner', now(), false)`);
  }

  async function grantExtra(workspaceId: string, userId: string, permission: string) {
    const roleId = newUuid();
    const assignmentId = newUuid();
    await client.db.execute(sql`INSERT INTO governance_roles
      (id, workspace_id, key, name, status, revision, created_at, updated_at)
      VALUES (${roleId}, ${workspaceId}, ${`SECURE_${permission}`},
        'Secure identifier role', 'ACTIVE', 1, now(), now())`);
    await client.db.execute(sql`INSERT INTO governance_role_permissions
      (role_id, permission) VALUES (${roleId}, ${permission})`);
    await client.db.execute(sql`INSERT INTO governance_role_assignments
      (id, workspace_id, role_id, subject_type, subject_id, scope_type,
       scope_resource_type, scope_resource_id, status, revision,
       granted_by_subject_type, granted_by_subject_id, granted_at, case_membership)
      VALUES (${assignmentId}, ${workspaceId}, ${roleId}, 'USER', ${userId},
        'WORKSPACE', null, null, 'ACTIVE', 1, 'USER', 'owner', now(), false)`);
    return assignmentId;
  }

  function get(path: string, user = "owner") {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("authorization", `Bearer ${user}`);
  }
  function create(
    workspaceId: string,
    key = newUuid(),
    input: object = body,
    user = "owner",
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/workspaces/${workspaceId}/entities`)
      .set("authorization", `Bearer ${user}`)
      .set("idempotency-key", key)
      .send(input);
  }
  function patch(id: string, input: object, revision: number, user = "owner") {
    return request(app.getHttpServer())
      .patch(`/api/v1/entities/${id}`)
      .set("authorization", `Bearer ${user}`)
      .set("if-match", `"${revision}"`)
      .send(input);
  }
  function merge(
    survivorEntityId: string,
    input: object,
    survivorRevision: number,
    key = newUuid(),
    operationId = newUuid(),
    user = "owner",
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/entities/${survivorEntityId}/actions/merge`)
      .set("authorization", `Bearer ${user}`)
      .set("if-match", `"${survivorRevision}"`)
      .set("idempotency-key", key)
      .set("x-audit-operation-id", operationId)
      .send(input);
  }
  function reverseMerge(
    mergeId: string,
    input: object,
    key = newUuid(),
    operationId = newUuid(),
    user = "owner",
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/entity-merges/${mergeId}/actions/reverse`)
      .set("authorization", `Bearer ${user}`)
      .set("idempotency-key", key)
      .set("x-audit-operation-id", operationId)
      .send(input);
  }
  function createIdentifier(
    entityId: string,
    key: string,
    input: object,
    user = "owner",
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/entities/${entityId}/identifiers`)
      .set("authorization", `Bearer ${user}`)
      .set("idempotency-key", key)
      .send(input);
  }
  function asUser<T>(work: () => Promise<T>): Promise<T> {
    return context.run(
      {
        requestId: newUuid(),
        traceId: newUuid(),
        issuedAt: new Date().toISOString(),
        principal: {
          kind: "USER",
          subject: "owner",
          userId: "owner",
          issuer: "https://identity.example.test",
        },
      },
      work,
    );
  }
});
