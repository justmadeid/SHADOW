import fs from "node:fs";
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
import { SubjectModule } from "../../subject.module.js";
import { CaseFacade } from "../../../case/index.js";
import { InvestigationFacade } from "../../../investigation/index.js";
import { WorkspaceFacade } from "../../../workspace/index.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { AuthenticationGuard } from "../../../../platform/auth/authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "../../../../platform/auth/authentication.tokens.js";
import { PlatformExceptionFilter } from "../../../../platform/errors/http-exception.filter.js";
import { newUuid } from "../../../../platform/ids/uuid.js";

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
    if (!["owner", "peer", "outsider"].includes(token))
      throw new Error("Invalid synthetic token");
    return {
      kind: "USER",
      subject: token,
      userId: token,
      issuer: "https://identity.example.test",
    };
  },
};
const body = { subjectType: "PERSON", role: "PRIMARY_TARGET" };

describe("P2 Subject HTTP and PostgreSQL", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let context: RequestContextStore;
  let cases: CaseFacade;
  let investigations: InvestigationFacade;
  let workspaces: WorkspaceFacade;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../../../entity/infrastructure/persistence/migrations/0001_create_entity_registry.sql",
      "../../../entity/infrastructure/persistence/migrations/0002_create_secure_identifiers.sql",
      "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../../../investigation/infrastructure/persistence/migrations/0001_create_investigation.sql",
      "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "../../../governance/infrastructure/persistence/migrations/0003_subject_permissions.sql",
      "../../../governance/infrastructure/persistence/migrations/0004_workflow_run_permissions.sql",
      "./migrations/0001_create_subject.sql",
      "./migrations/0002_create_subject_seed.sql",
      "./migrations/0003_subject_resolution.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );
    const module = await Test.createTestingModule({
      imports: [SubjectModule],
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        AuthenticationGuard,
        { provide: APP_GUARD, useExisting: AuthenticationGuard },
      ],
    })
      .overrideProvider(PLATFORM_DB_CLIENT)
      .useValue(client)
      .compile();
    context = module.get(RequestContextStore);
    cases = module.get(CaseFacade);
    investigations = module.get(InvestigationFacade);
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

  it("creates once across concurrent replays, with one revision and Outbox event", async () => {
    const f = await fixture();
    const key = newUuid();
    const responses = await Promise.all([
      create(f.id, key).expect(201),
      create(f.id, key).expect(201),
    ]);
    const value = responses[0]!.body;
    expect(value.id).toBe(responses[1]!.body.id);
    expect(value).toMatchObject({
      workspaceId: f.workspaceId,
      caseId: f.id,
      status: "UNRESOLVED",
      entityRef: null,
      revision: 1,
    });
    expect(responses[0]!.headers.etag).toBe('"1"');
    expect((await get(`/subjects/${value.id}`).expect(200)).body).toEqual(value);
    const revisions = await client.db.execute(
      sql`SELECT * FROM subject_revisions WHERE subject_id = ${value.id}`,
    );
    expect(revisions.rows).toHaveLength(1);
    const events = await client.db.execute(
      sql`SELECT payload FROM platform_outbox_events WHERE aggregate_id = ${value.id}`,
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.payload).toMatchObject({ subjectId: value.id, revision: 1 });
    await create(f.id, key, { ...body, role: "WITNESS" }).expect(409);
  });

  it("persists typed seed provenance and masks sensitive response values", async () => {
    const f = await fixture();
    const key = newUuid();
    const seeded = {
      ...body,
      seed: {
        fields: [
          {
            name: "DISPLAY_NAME",
            value: "  Synthetic Person  ",
            origin: "INVESTIGATOR_INPUT",
            classification: "INTERNAL",
          },
          {
            name: "USERNAME",
            value: "synthetic_user",
            origin: "INVESTIGATOR_INPUT",
            classification: "SENSITIVE",
          },
        ],
      },
    };
    const created = await create(f.id, key, seeded).expect(201);
    expect(created.body.seed).toMatchObject({ fieldCount: 2 });
    const seed = await get(`/subjects/${created.body.id}/seed`).expect(200);
    expect(seed.body).toMatchObject({
      id: created.body.seed.id,
      subjectId: created.body.id,
      workspaceId: f.workspaceId,
      caseId: f.id,
    });
    expect(seed.body.fields[0]).toMatchObject({
      ordinal: 0,
      name: "DISPLAY_NAME",
      origin: "INVESTIGATOR_INPUT",
      classification: "INTERNAL",
      evidenceRef: null,
      sourceRecordRef: null,
      value: {
        visibility: "FULL",
        displayValue: "Synthetic Person",
        classification: "INTERNAL",
      },
    });
    expect(seed.body.fields[1]).toMatchObject({
      name: "USERNAME",
      value: {
        visibility: "MASKED",
        displayValue: "••••",
        classification: "SENSITIVE",
      },
    });
    expect(JSON.stringify(seed.body)).not.toContain("synthetic_user");
    const stored = await client.db.execute(
      sql`SELECT value_text, classification FROM subject_seed_fields WHERE seed_id = ${created.body.seed.id} ORDER BY ordinal`,
    );
    expect(stored.rows).toEqual([
      { value_text: "Synthetic Person", classification: "INTERNAL" },
      { value_text: "synthetic_user", classification: "SENSITIVE" },
    ]);
    await expect(
      client.db.execute(
        sql`UPDATE subject_seed_fields SET value_text = 'mutated' WHERE seed_id = ${created.body.seed.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      client.db.execute(
        sql`DELETE FROM subject_seeds WHERE id = ${created.body.seed.id}`,
      ),
    ).rejects.toThrow();
    const event = await client.db.execute(
      sql`SELECT payload FROM platform_outbox_events WHERE aggregate_id = ${created.body.id}`,
    );
    expect(JSON.stringify(event.rows)).not.toContain("Synthetic Person");
    expect(JSON.stringify(event.rows)).not.toContain("synthetic_user");

    expect((await create(f.id, key, seeded).expect(201)).body.id).toBe(created.body.id);
    await create(f.id, key, {
      ...seeded,
      seed: {
        fields: [{ ...seeded.seed.fields[0], value: "Different Person" }],
      },
    }).expect(409);
  });

  it("rejects unverified provenance, incompatible fields and restricted storage", async () => {
    const f = await fixture();
    const seed = (field: object) => ({ ...body, seed: { fields: [field] } });
    await create(
      f.id,
      newUuid(),
      seed({
        name: "DISPLAY_NAME",
        value: "Synthetic",
        origin: "EVIDENCE",
        classification: "INTERNAL",
        evidenceRef: {
          type: "EVIDENCE",
          id: newUuid(),
          workspaceId: f.workspaceId,
          caseId: f.id,
        },
      }),
    ).expect(400);
    await create(
      f.id,
      newUuid(),
      seed({
        name: "DISPLAY_NAME",
        value: "Restricted synthetic value",
        origin: "INVESTIGATOR_INPUT",
        classification: "RESTRICTED",
      }),
    ).expect(409);
    await create(f.id, newUuid(), {
      subjectType: "DOMAIN",
      role: "PRIMARY_TARGET",
      seed: {
        fields: [
          {
            name: "DISPLAY_NAME",
            value: "Not a domain",
            origin: "INVESTIGATOR_INPUT",
            classification: "INTERNAL",
          },
        ],
      },
    }).expect(400);
    await create(
      f.id,
      newUuid(),
      seed({
        name: "DISPLAY_NAME",
        value: "x".repeat(301),
        origin: "INVESTIGATOR_INPUT",
        classification: "INTERNAL",
      }),
    ).expect(400);
  });

  it("denies unauthenticated, service, cross-Workspace and same-Workspace nonmembers", async () => {
    const f = await fixture();
    const value = (await create(f.id).expect(201)).body;
    await request(app.getHttpServer()).get(`/api/v1/subjects/${value.id}`).expect(401);
    await get(`/subjects/${value.id}`, "worker").expect(403);
    for (const user of ["peer", "outsider"]) {
      const denied = await get(`/subjects/${value.id}`, user).expect(404);
      const absent = await get(`/subjects/${newUuid()}`, user).expect(404);
      expect(denied.body.error.code).toBe(absent.body.error.code);
      await get(`/subjects/${value.id}/seed`, user).expect(404);
      await get(`/cases/${f.id}/subjects`, user).expect(404);
      await create(f.id, newUuid(), body, user).expect(404);
      await patch(value.id, { role: "WITNESS" }, 1, user).expect(404);
    }
  });

  it("enforces VIEWER read-only and reauthorizes after revocation", async () => {
    const f = await fixture();
    const key = newUuid();
    const value = (await create(f.id, key).expect(201)).body;
    const membership = await asUser(() =>
      cases.addMember(f.id, "peer", "VIEWER", "Synthetic read access"),
    );
    await get(`/subjects/${value.id}`, "peer").expect(200);
    await create(f.id, newUuid(), body, "peer").expect(404);
    await patch(value.id, { role: "WITNESS" }, 1, "peer").expect(404);
    await asUser(() =>
      cases.removeMember(
        f.id,
        membership.id,
        membership.revision,
        "Synthetic revocation",
      ),
    );
    await get(`/subjects/${value.id}`, "peer").expect(404);
    // A revoked creator cannot retrieve an idempotent replay either.
    await client.db.execute(
      sql`UPDATE workspace_members SET status = 'REMOVED' WHERE workspace_id = ${f.workspaceId} AND user_id = 'owner'`,
    );
    await create(f.id, key).expect(404);
  });

  it("supports EDITOR writes and rejects concurrent stale updates", async () => {
    const f = await fixture();
    await asUser(() => cases.addMember(f.id, "peer", "EDITOR", "Synthetic edit access"));
    const value = (await create(f.id, newUuid(), body, "peer").expect(201)).body;
    const results = await Promise.all([
      patch(value.id, { role: "WITNESS" }, 1, "peer"),
      patch(value.id, { role: "RELATED_PERSON" }, 1, "peer"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
    const archived = await patch(value.id, { status: "ARCHIVED" }, 2).expect(200);
    expect(archived.body.revision).toBe(3);
    await patch(value.id, { role: "WITNESS" }, 3).expect(409);
    expect(
      (
        await client.db.execute(
          sql`SELECT revision FROM subject_revisions WHERE subject_id = ${value.id}`,
        )
      ).rows,
    ).toHaveLength(3);
    await expect(
      client.db.execute(
        sql`UPDATE subject_revisions SET role = 'WITNESS' WHERE subject_id = ${value.id}`,
      ),
    ).rejects.toThrow();
  });

  it("validates optional Investigation scope and active lifecycle", async () => {
    const f = await fixture();
    const other = await fixture();
    const branch = await asUser(() =>
      investigations.create(
        f.id,
        { title: "Synthetic branch", objective: "Synthetic objective" },
        newUuid(),
      ),
    );
    await create(f.id, newUuid(), { ...body, investigationId: branch.id }).expect(201);
    await create(other.id, newUuid(), { ...body, investigationId: branch.id }).expect(
      404,
    );
    await asUser(() => investigations.update(branch.id, { status: "COMPLETED" }, 1));
    await create(f.id, newUuid(), { ...body, investigationId: branch.id }).expect(409);
    await create(f.id, newUuid(), { ...body, investigationId: newUuid() }).expect(404);
  });

  it("closed/archived Cases remain readable but prohibit Subject mutation", async () => {
    const f = await fixture();
    const value = (await create(f.id).expect(201)).body;
    await asUser(() => cases.transition(f.id, "CLOSE", 1));
    await get(`/subjects/${value.id}`).expect(200);
    await create(f.id).expect(409);
    await patch(value.id, { role: "WITNESS" }, 1).expect(409);
    await asUser(() => cases.transition(f.id, "ARCHIVE", 2));
    await create(f.id).expect(409);
  });

  it("rejects mass assignment, malformed headers, query abuse and fake resolution", async () => {
    const f = await fixture();
    for (const extra of [
      { entityRef: { id: newUuid() } },
      { workspaceId: newUuid() },
      { status: "RESOLVED" },
      { seed: { value: "unproven" } },
      { subjectType: "DEVICE" },
    ]) {
      await create(f.id, newUuid(), { ...body, ...extra }).expect(400);
    }
    const value = (await create(f.id).expect(201)).body;
    for (const changes of [
      {},
      { status: "RESOLVED" },
      { status: "RESOLVING" },
      { role: "WITNESS", status: "ARCHIVED" },
      { entityRef: null },
    ])
      await patch(value.id, changes, 1).expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/subjects/${value.id}`)
      .set("authorization", "Bearer owner")
      .send({ role: "WITNESS" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/cases/${f.id}/subjects`)
      .set("authorization", "Bearer owner")
      .send(body)
      .expect(400);
    await get(`/cases/${f.id}/subjects?limit=101`).expect(400);
    await get(`/cases/${f.id}/subjects?limit=1&limit=2`).expect(400);
    await get(`/cases/${f.id}/subjects?workspaceId=${f.workspaceId}`).expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/subjects/${value.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .expect(404);
    await expect(
      client.db.execute(
        sql`UPDATE investigation_subjects SET status = 'RESOLVED' WHERE id = ${value.id}`,
      ),
    ).rejects.toThrow();
  });

  it("paginates on stable IDs with Case-bound cursors", async () => {
    const f = await fixture();
    const first = (await create(f.id).expect(201)).body;
    await create(f.id).expect(201);
    const page = (await get(`/cases/${f.id}/subjects?limit=1`).expect(200)).body;
    expect(page.items).toHaveLength(1);
    expect(page.page.hasMore).toBe(true);
    const second = (
      await get(`/cases/${f.id}/subjects?limit=1&cursor=${page.page.nextCursor}`).expect(
        200,
      )
    ).body;
    expect(second.items[0].id).toBe(first.id);
    expect(second.page).toEqual({ hasMore: false, nextCursor: null });
    const other = await fixture();
    await get(`/cases/${other.id}/subjects?cursor=${page.page.nextCursor}`).expect(400);
  });

  it("rolls back Subject, history and replay record if Outbox insertion fails", async () => {
    const f = await fixture();
    const key = newUuid();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_subject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'SUBJECT_CREATED' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_subject_event BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_subject_event();`,
      ),
    );
    try {
      const failed = await create(f.id, key, {
        ...body,
        seed: {
          fields: [
            {
              name: "DISPLAY_NAME",
              value: "Rollback Seed",
              origin: "INVESTIGATOR_INPUT",
              classification: "INTERNAL",
            },
          ],
        },
      }).expect(500);
      expect(JSON.stringify(failed.body)).not.toContain("synthetic-private");
      expect(
        (
          await client.db.execute(
            sql`SELECT id FROM investigation_subjects WHERE case_id = ${f.id}`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.db.execute(
            sql`SELECT id FROM subject_seeds WHERE case_id = ${f.id}`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.db.execute(
            sql`SELECT subject_id FROM subject_idempotency WHERE idempotency_key = ${key}`,
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_subject_event ON platform_outbox_events; DROP FUNCTION fail_subject_event();",
        ),
      );
    }
    await create(f.id, key, {
      ...body,
      seed: {
        fields: [
          {
            name: "DISPLAY_NAME",
            value: "Rollback Seed",
            origin: "INVESTIGATOR_INPUT",
            classification: "INTERNAL",
          },
        ],
      },
    }).expect(201);
  });

  async function fixture() {
    const workspace = await asUser(() =>
      workspaces.create(
        {
          name: "Synthetic Subjects",
          slug: `subjects-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
    );
    await client.db.execute(
      sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at) VALUES (${newUuid()}, ${workspace.id}, 'peer', 'ACTIVE', now())`,
    );
    return asUser(() =>
      cases.create(
        {
          workspaceId: workspace.id,
          title: "Synthetic Case",
          classification: "SENSITIVE",
        },
        newUuid(),
      ),
    );
  }
  function get(path: string, user = "owner") {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("authorization", `Bearer ${user}`);
  }
  function create(caseId: string, key = newUuid(), input: object = body, user = "owner") {
    return request(app.getHttpServer())
      .post(`/api/v1/cases/${caseId}/subjects`)
      .set("authorization", `Bearer ${user}`)
      .set("idempotency-key", key)
      .send(input);
  }
  function patch(id: string, input: object, revision: number, user = "owner") {
    return request(app.getHttpServer())
      .patch(`/api/v1/subjects/${id}`)
      .set("authorization", `Bearer ${user}`)
      .set("if-match", `"${revision}"`)
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
