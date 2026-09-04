import fs from "node:fs";
import { sql } from "drizzle-orm";
import { Test, type TestingModule } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import type { AccessTokenVerifier } from "@intelligence/auth";
import { createDatabaseClient, DrizzleTransactionManager } from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Logger } from "pino";
import { CaseModule } from "../../case.module.js";
import { CaseFacade } from "../../application/case.facade.js";
import {
  InvestigationModule,
  InvestigationFacade,
} from "../../../investigation/index.js";
import { WorkspaceFacade } from "../../../workspace/index.js";
import { CaseMembershipFacade } from "../../../governance/index.js";
import { classificationHandling } from "../../../governance/index.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { AuthenticationGuard } from "../../../../platform/auth/authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "../../../../platform/auth/authentication.tokens.js";
import { PlatformExceptionFilter } from "../../../../platform/errors/http-exception.filter.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import { encodeCursor } from "../../../../platform/http/cursor.js";

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
      throw new Error("Invalid test token");
    return {
      kind: "USER",
      subject: token,
      userId: token,
      issuer: "https://identity.example.test",
    };
  },
};

describe("P1-006 Case authorization HTTP and persistence", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let module: TestingModule;
  let app: INestApplication;
  let context: RequestContextStore;
  let cases: CaseFacade;
  let investigations: InvestigationFacade;
  let transactions: DrizzleTransactionManager;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "./migrations/0001_create_case.sql",
      "../../../investigation/infrastructure/persistence/migrations/0001_create_investigation.sql",
      "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );
    module = await Test.createTestingModule({
      imports: [CaseModule, InvestigationModule],
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
    transactions = module.get(DrizzleTransactionManager);
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

  it("denies same-workspace nonmembers on every Case and Investigation route", async () => {
    const f = await fixture();
    await request(app.getHttpServer()).get(`/api/v1/cases/${f.case.id}`).expect(401);
    await get(`/cases/${f.case.id}`, "worker").expect(403);
    await get(`/cases/${f.case.id}`, "owner").expect(200);
    const denied = await get(`/cases/${f.case.id}`, "peer").expect(404);
    const absent = await get(`/cases/${newUuid()}`, "peer").expect(404);
    expect(denied.body.error.code).toBe(absent.body.error.code);
    expect(denied.body.error.message).toBe(absent.body.error.message);
    // Express may hash the error envelope; it must never expose the Case revision.
    expect(denied.headers.etag).not.toBe(`"${f.case.revision}"`);
    expect(JSON.stringify(denied.body)).not.toContain(f.case.title);
    const list = await get(`/cases?workspaceId=${f.workspaceId}`, "peer").expect(200);
    expect(list.body.items).toEqual([]);
    expect(list.body.page).toEqual({ hasMore: false, nextCursor: null });
    await get(`/cases?workspaceId=${f.workspaceId}`, "outsider").expect(404);
    await get(`/cases/${f.case.id}`, "outsider").expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/cases/${f.case.id}`)
      .set("authorization", "Bearer peer")
      .set("if-match", '"999"')
      .send({ title: "Denied change" })
      .expect(404);
    for (const action of ["close", "reopen", "archive"]) {
      await request(app.getHttpServer())
        .post(`/api/v1/cases/${f.case.id}/actions/${action}`)
        .set("authorization", "Bearer peer")
        .set("if-match", '"999"')
        .expect(404);
    }
    await get(`/cases/${f.case.id}/investigations`, "peer").expect(404);
    await get(`/investigations/${f.investigation.id}`, "peer").expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/cases/${f.case.id}/investigations`)
      .set("authorization", "Bearer peer")
      .set("idempotency-key", newUuid())
      .send({ title: "Denied branch", objective: "Denied objective" })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/investigations/${f.investigation.id}`)
      .set("authorization", "Bearer peer")
      .set("if-match", '"999"')
      .send({ title: "Denied branch" })
      .expect(404);
  });

  it("returns server-derived handling metadata on Case responses and rejects client policy injection", async () => {
    const f = await fixture();
    const detail = await get(`/cases/${f.case.id}`, "owner").expect(200);
    expect(detail.body.handling).toEqual(classificationHandling("SENSITIVE"));
    let revision = 1;
    for (const classification of ["PUBLIC", "INTERNAL", "RESTRICTED"] as const) {
      const changed = await request(app.getHttpServer())
        .patch(`/api/v1/cases/${f.case.id}`)
        .set("authorization", "Bearer owner")
        .set("if-match", `"${revision++}"`)
        .send({ classification })
        .expect(200);
      expect(changed.body.handling).toEqual(classificationHandling(classification));
    }
    const page = await get(`/cases?workspaceId=${f.workspaceId}`, "owner").expect(200);
    expect(page.body.items[0].handling).toEqual(classificationHandling("RESTRICTED"));
    await request(app.getHttpServer())
      .patch(`/api/v1/cases/${f.case.id}`)
      .set("authorization", "Bearer owner")
      .set("if-match", `"${revision}"`)
      .send({ handling: { classification: "PUBLIC" } })
      .expect(400);
    const denied = await get(`/cases/${f.case.id}`, "peer").expect(404);
    expect(denied.body).not.toHaveProperty("handling");
  });

  it("allows VIEWER reads but not writes; EDITOR cannot manage membership", async () => {
    const f = await fixture();
    const member = await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "VIEWER", "Case review"),
    );
    await get(`/cases/${f.case.id}`, "peer").expect(200);
    await get(`/investigations/${f.investigation.id}`, "peer").expect(200);
    await expect(
      asUser("peer", () => cases.update(f.case.id, { title: "Not allowed" }, 1)),
    ).rejects.toMatchObject({ code: "CASE_NOT_FOUND", statusCode: 404 });
    await expect(
      asUser("peer", () =>
        investigations.create(
          f.case.id,
          { title: "Not allowed", objective: "Viewer cannot create" },
          newUuid(),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      asUser("peer", () =>
        investigations.update(f.investigation.id, { title: "Not allowed" }, 1),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await asUser("owner", () =>
      cases.removeMember(
        f.case.id,
        member.id,
        member.revision,
        "Promote via explicit regrant",
      ),
    );
    await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "EDITOR", "Case collaboration"),
    );
    await expect(
      asUser("peer", () => cases.update(f.case.id, { title: "Editor update" }, 1)),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(
      asUser("peer", () =>
        investigations.update(f.investigation.id, { title: "Editor branch" }, 1),
      ),
    ).resolves.toMatchObject({ revision: 2 });
    await expect(
      asUser("peer", () => cases.addMember(f.case.id, "owner", "OWNER", "Escalation")),
    ).rejects.toMatchObject({ statusCode: 404 });
    const other = await asUser("owner", () =>
      cases.create(
        {
          workspaceId: f.workspaceId,
          title: "Another Case in same Workspace",
          classification: "INTERNAL",
        },
        newUuid(),
      ),
    );
    await get(`/cases/${other.id}`, "peer").expect(404);
  });

  it("revokes deep-link/list access without reviving a removed creator on idempotency replay", async () => {
    const f = await fixture();
    await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "OWNER", "Second owner"),
    );
    const original = await ownerMembership(f.case.id);
    await asUser("peer", () =>
      cases.removeMember(f.case.id, original.id, 1, "Creator removed"),
    );
    await get(`/cases/${f.case.id}`, "owner").expect(404);
    await get(`/investigations/${f.investigation.id}`, "owner").expect(404);
    const list = await get(`/cases?workspaceId=${f.workspaceId}`, "owner").expect(200);
    expect(list.body.items).toEqual([]);
    await expect(
      asUser("owner", () => cases.create(f.input, f.key)),
    ).rejects.toMatchObject({ code: "CASE_NOT_FOUND", statusCode: 404 });
    const state = await client.db.execute(
      sql`SELECT status FROM governance_role_assignments WHERE id = ${original.id}`,
    );
    expect(state.rows[0]?.status).toBe("REVOKED");
  });

  it("requires active Workspace membership even with a valid Case grant", async () => {
    const f = await fixture();
    await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "EDITOR", "Case team"),
    );
    await client.db
      .execute(sql`UPDATE workspace_members SET status = 'REMOVED', removed_at = now()
      WHERE workspace_id = ${f.workspaceId} AND user_id = 'peer'`);
    await get(`/cases/${f.case.id}`, "peer").expect(404);
    await get(`/investigations/${f.investigation.id}`, "peer").expect(404);
    await expect(
      asUser("owner", () =>
        cases.addMember(f.case.id, "outsider", "VIEWER", "Wrong Workspace"),
      ),
    ).rejects.toMatchObject({ code: "CASE_MEMBER_NOT_ELIGIBLE" });
  });

  it("does not infer Case detail access from broad Workspace or discovery grants", async () => {
    const f = await fixture();
    const roleId = newUuid();
    await client.db.execute(sql`INSERT INTO governance_roles
      (id, workspace_id, key, name, status, created_at, updated_at)
      VALUES (${roleId}, ${f.workspaceId}, 'BROAD_ROLE', 'Broad role', 'ACTIVE', now(), now())`);
    await client.db
      .execute(sql`INSERT INTO governance_role_permissions (role_id, permission)
      VALUES (${roleId}, 'CASE_VIEW'), (${roleId}, 'DISCOVER_ENTITY_EXISTENCE')`);
    await client.db.execute(sql`INSERT INTO governance_role_assignments
      (id,workspace_id,role_id,subject_type,subject_id,scope_type,status,granted_by_subject_type,granted_by_subject_id,granted_at)
      VALUES (${newUuid()},${f.workspaceId},${roleId},'USER','peer','WORKSPACE','ACTIVE','USER','owner',now())`);
    await get(`/cases/${f.case.id}`, "peer").expect(404);
    expect(
      (await get(`/cases?workspaceId=${f.workspaceId}`, "peer").expect(200)).body.items,
    ).toEqual([]);
  });

  it("keeps membership changes idempotent, revision checked, scoped, and durably recorded", async () => {
    const f = await fixture();
    const first = await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "VIEWER", "Review only"),
    );
    const again = await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "VIEWER", "Review only"),
    );
    expect(again.id).toBe(first.id);
    await expect(
      asUser("owner", () =>
        cases.addMember(f.case.id, "peer", "OWNER", "Different role"),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      asUser("owner", () => cases.removeMember(f.case.id, first.id, 999, "Stale")),
    ).rejects.toMatchObject({ statusCode: 412 });
    const another = await asUser("owner", () =>
      cases.create({ ...f.input, title: "Other Case" }, newUuid()),
    );
    await expect(
      asUser("owner", () => cases.removeMember(another.id, first.id, 1, "Wrong Case")),
    ).rejects.toMatchObject({ code: "CASE_MEMBER_NOT_FOUND" });
    await asUser("owner", () =>
      cases.removeMember(f.case.id, first.id, 1, "Access withdrawn"),
    );
    const history = await client.db
      .execute(sql`SELECT action, reason, actor_subject_id FROM governance_assignment_history
      WHERE assignment_id = ${first.id} ORDER BY occurred_at`);
    expect(history.rows).toEqual([
      { action: "GRANTED", reason: "Review only", actor_subject_id: "owner" },
      { action: "REVOKED", reason: "Access withdrawn", actor_subject_id: "owner" },
    ]);
    const events = await client.db.execute(sql`SELECT payload FROM platform_outbox_events
      WHERE event_type = 'CASE_MEMBERSHIP_CHANGED' AND payload->>'membershipId' = ${first.id}`);
    expect(events.rows).toHaveLength(2);
    for (const row of events.rows) {
      expect(row.payload).not.toHaveProperty("userId");
      expect(row.payload).not.toHaveProperty("reason");
      expect(row.payload).toHaveProperty("historyId");
    }
  });

  it("preserves a last owner under concurrent membership removals", async () => {
    const f = await fixture();
    const original = await ownerMembership(f.case.id);
    await expect(
      asUser("owner", () => cases.removeMember(f.case.id, original.id, 1, "Last owner")),
    ).rejects.toMatchObject({ code: "CASE_LAST_OWNER" });
    const peer = await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "OWNER", "Second owner"),
    );
    const results = await Promise.allSettled([
      asUser("owner", () => cases.removeMember(f.case.id, peer.id, 1, "Remove peer")),
      asUser("peer", () =>
        cases.removeMember(f.case.id, original.id, 1, "Remove original"),
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const remaining = await client.db
      .execute(sql`SELECT count(*)::int AS count FROM governance_role_assignments
      WHERE case_membership AND scope_resource_id = ${f.case.id} AND status = 'ACTIVE'`);
    expect(remaining.rows[0]?.count).toBe(1);
  });

  it.each(["Case", "Investigation"])(
    "reauthorizes a queued %s write after concurrent revocation",
    async (kind) => {
      const f = await fixture();
      const member = await asUser("owner", () =>
        cases.addMember(f.case.id, "peer", "EDITOR", "Collaboration"),
      );
      let release!: () => void;
      let ready!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prepared = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const removal = asUser("owner", () =>
        transactions.run(async () => {
          await cases.removeMember(f.case.id, member.id, 1, "Concurrent access removal");
          ready();
          await held;
        }),
      );
      // A failed setup must not leave the awaiting test or transaction hanging.
      await Promise.race([prepared, removal]);
      const membershipFacade = module.get(CaseMembershipFacade);
      const originalLock = membershipFacade.lockCase.bind(membershipFacade);
      let queued = false;
      const lock = vi
        .spyOn(membershipFacade, "lockCase")
        .mockImplementation((workspaceId, caseId) => {
          queued = true;
          return originalLock(workspaceId, caseId);
        });
      const write =
        kind === "Case"
          ? asUser("peer", () =>
              cases.update(f.case.id, { title: "Queued unauthorized update" }, 1),
            )
          : asUser("peer", () =>
              investigations.update(
                f.investigation.id,
                { title: "Queued unauthorized update" },
                1,
              ),
            );
      const outcome = write.then(
        () => ({ statusCode: 200 }),
        (error: { statusCode: number }) => error,
      );
      try {
        await vi.waitFor(() => expect(queued).toBe(true), { timeout: 2000 });
      } finally {
        release();
        await removal;
        lock.mockRestore();
      }
      expect(await outcome).toMatchObject({ statusCode: 404 });
      const unchanged =
        kind === "Case"
          ? await asUser("owner", () => cases.get(f.case.id))
          : await asUser("owner", () => investigations.get(f.investigation.id));
      expect(unchanged.revision).toBe(1);
    },
  );

  it("rolls back the Case, owner, history, and idempotency when durable outbox insertion fails", async () => {
    const f = await fixture();
    await client.db.execute(
      sql.raw(`
      CREATE FUNCTION fail_membership_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type = 'CASE_MEMBERSHIP_CHANGED' THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_membership BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_membership_event();
    `),
    );
    const key = newUuid();
    try {
      await expect(
        asUser("owner", () => cases.create({ ...f.input, title: "Rollback Case" }, key)),
      ).rejects.toThrow();
      const rows = await client.db.execute(
        sql`SELECT case_id FROM case_idempotency WHERE idempotency_key = ${key}`,
      );
      expect(rows.rows).toEqual([]);
      const count = await client.db.execute(
        sql`SELECT count(*)::int AS count FROM cases WHERE workspace_id = ${f.workspaceId}`,
      );
      expect(count.rows[0]?.count).toBe(1);
      const memberCount = await client.db.execute(
        sql`SELECT count(*)::int AS count FROM governance_role_assignments WHERE workspace_id = ${f.workspaceId}`,
      );
      expect(memberCount.rows[0]?.count).toBe(1);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_membership ON platform_outbox_events; DROP FUNCTION fail_membership_event();",
        ),
      );
    }
  });

  it("returns a sanitized 503 and commits no Case when critical audit is unavailable", async () => {
    const f = await fixture();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_http_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-private-audit-details'; END $$; CREATE TRIGGER fail_http_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_http_audit();`,
      ),
    );
    const key = newUuid();
    try {
      const response = await request(app.getHttpServer())
        .post("/api/v1/cases")
        .set("authorization", "Bearer owner")
        .set("idempotency-key", key)
        .send({ ...f.input, title: "Audit failure case" })
        .expect(503);
      expect(response.body.error.code).toBe("AUDIT_DURABILITY_FAILED");
      expect(JSON.stringify(response.body)).not.toContain("synthetic-private");
      expect(
        (
          await client.db.execute(
            sql`SELECT case_id FROM case_idempotency WHERE idempotency_key = ${key}`,
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await client.db.execute(
            sql`SELECT id FROM cases WHERE workspace_id = ${f.workspaceId}`,
          )
        ).rows,
      ).toHaveLength(1);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_http_audit ON audit_events; DROP FUNCTION fail_http_audit();",
        ),
      );
    }
  });

  it("paginates authorized Case IDs before LIMIT, binding cursors to the requested Workspace", async () => {
    const f = await fixture();
    await asUser("owner", () =>
      transactions.run(async () => {
        for (let i = 0; i < 100; i++)
          await cases.create({ ...f.input, title: `Page Case ${i}` }, newUuid());
      }),
    );
    const first = await get(`/cases?workspaceId=${f.workspaceId}`, "owner").expect(200);
    expect(first.body.items).toHaveLength(100);
    expect(first.body.page.hasMore).toBe(true);
    const second = await get(
      `/cases?workspaceId=${f.workspaceId}&cursor=${first.body.page.nextCursor}`,
      "owner",
    ).expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).toBe(f.case.id);
    expect(second.body.page).toEqual({ hasMore: false, nextCursor: null });
    await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "VIEWER", "Only oldest Case"),
    );
    const peerPage = await get(`/cases?workspaceId=${f.workspaceId}`, "peer").expect(200);
    expect(peerPage.body.items.map((item: { id: string }) => item.id)).toEqual([
      f.case.id,
    ]);
    // Possession of another actor's cursor never grants its underlying scope.
    expect(
      (
        await get(
          `/cases?workspaceId=${f.workspaceId}&cursor=${first.body.page.nextCursor}`,
          "peer",
        ).expect(200)
      ).body.items,
    ).toHaveLength(1);
    await get(
      `/cases?workspaceId=${f.workspaceId}&cursor=${encodeCursor({ workspaceId: newUuid(), before: f.case.id })}`,
      "owner",
    ).expect(400);
    await get(`/cases?workspaceId=${f.workspaceId}&cursor=invalid`, "owner").expect(400);
  });

  async function fixture() {
    const workspace = await asUser("owner", () =>
      module.get(WorkspaceFacade).create(
        {
          name: "Case access test",
          slug: `access-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
    );
    await client.db
      .execute(sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at)
      VALUES (${newUuid()}, ${workspace.id}, 'peer', 'ACTIVE', now())`);
    const input = {
      workspaceId: workspace.id,
      title: "Confidential Case",
      classification: "SENSITIVE" as const,
    };
    const key = newUuid();
    const created = await asUser("owner", () => cases.create(input, key));
    const investigation = await asUser("owner", () =>
      investigations.create(
        created.id,
        { title: "Private branch", objective: "Private objective" },
        newUuid(),
      ),
    );
    return { workspaceId: workspace.id, case: created, investigation, input, key };
  }

  function get(path: string, user: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set("authorization", `Bearer ${user}`);
  }
  function asUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
    return context.run(
      {
        requestId: newUuid(),
        traceId: newUuid(),
        issuedAt: new Date().toISOString(),
        principal: {
          kind: "USER",
          subject: userId,
          userId,
          issuer: "https://identity.example.test",
        },
      },
      work,
    );
  }
  async function ownerMembership(caseId: string): Promise<{ id: string }> {
    const rows = await client.db.execute(sql`SELECT id FROM governance_role_assignments
      WHERE scope_resource_id = ${caseId} AND subject_id = 'owner' AND case_membership AND status = 'ACTIVE'`);
    return rows.rows[0] as { id: string };
  }
});
