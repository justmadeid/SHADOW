import fs from "node:fs";
import { sql } from "drizzle-orm";
import { version as uuidVersion } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDatabaseClient,
  DatabaseContext,
  DrizzleTransactionManager,
} from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { type Workspace, WorkspaceFacade } from "../../../workspace/index.js";
import { PostgresOutboxStore } from "../../../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { CaseFacade } from "../../application/case.facade.js";
import { PostgresCaseRepository } from "./postgres-case.repository.js";

describe("Case persistence", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let context: RequestContextStore;
  let cases: CaseFacade;
  let workspaces: WorkspaceFacade;
  let workspaceId: string;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 5 });
    const database = new DatabaseContext(client.db);
    const transactions = new DrizzleTransactionManager(client.db);
    context = new RequestContextStore();

    for (const migration of [
      new URL(
        "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
        import.meta.url,
      ),
      new URL(
        "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
        import.meta.url,
      ),
      new URL("./migrations/0001_create_case.sql", import.meta.url),
    ]) {
      await client.db.execute(sql.raw(fs.readFileSync(migration, "utf8")));
    }

    const now = new Date();
    workspaceId = newUuid();
    await client.db.execute(sql`
      INSERT INTO workspaces (
        id, name, slug, status, revision, created_by_user_id, created_at, updated_at
      ) VALUES (
        ${workspaceId}, 'Investigations', 'case-test-workspace', 'ACTIVE', 1,
        'user-a', ${now}, ${now}
      )
    `);

    const workspaceFixture: Workspace = {
      id: workspaceId,
      name: "Investigations",
      slug: "case-test-workspace",
      status: "ACTIVE",
      settings: { locale: "id-ID", timeZone: "Asia/Jakarta" },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const workspaceAccessRepository = {
      async createForUser(): Promise<never> {
        throw new Error("Workspace creation is outside this Case integration test.");
      },
      async listForUser(userId: string): Promise<Workspace[]> {
        return userId === "user-a" ? [workspaceFixture] : [];
      },
      async findByIdForUser(id: string, userId: string): Promise<Workspace | undefined> {
        return id === workspaceId && userId === "user-a" ? workspaceFixture : undefined;
      },
    };

    const outbox = new PostgresOutboxStore(database, context);
    workspaces = new WorkspaceFacade(workspaceAccessRepository, transactions, context);
    cases = new CaseFacade(
      new PostgresCaseRepository(database, outbox),
      transactions,
      context,
      workspaces,
    );
  });

  afterAll(async () => {
    await client?.pool.end();
    await started?.container.stop();
  });

  it("atomically creates and replays a UUIDv7 Case with a non-sequential code", async () => {
    const first = await createCase("case-create-0001");
    const replay = await createCase("case-create-0001");

    expect(uuidVersion(first.id)).toBe(7);
    expect(first.code).toMatch(/^CASE-\d{4}-[A-F0-9]{10}$/);
    expect(first).toMatchObject({
      workspaceId,
      status: "DRAFT",
      classification: "SENSITIVE",
      revision: 1,
    });
    expect(replay.id).toBe(first.id);

    const result = await client.db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM cases) AS cases,
        (SELECT count(*)::int FROM case_idempotency) AS idempotency,
        (SELECT count(*)::int FROM platform_outbox_events
          WHERE event_type = 'CASE_CREATED') AS created_events
    `);
    expect(result.rows[0]).toMatchObject({ cases: 1, idempotency: 1, created_events: 1 });
  });

  it("keeps Case reads within an accessible Workspace", async () => {
    const visible = await runAsUser("user-a", () => cases.list(workspaceId));
    expect(visible).toHaveLength(1);

    await expect(
      runAsUser("user-b", () => cases.get(visible[0]!.id)),
    ).rejects.toMatchObject({ code: "CASE_NOT_FOUND", statusCode: 404 });
    await expect(
      runAsUser("user-b", () => cases.list(workspaceId)),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND", statusCode: 404 });
  });

  it("updates mutable metadata and rejects stale revisions", async () => {
    const [created] = await runAsUser("user-a", () => cases.list(workspaceId));
    const updated = await runAsUser("user-a", () =>
      cases.update(
        created!.id,
        { title: "Updated Investigation", classification: "RESTRICTED" },
        1,
      ),
    );

    expect(updated).toMatchObject({
      title: "Updated Investigation",
      classification: "RESTRICTED",
      revision: 2,
    });
    await expect(
      runAsUser("user-a", () => cases.update(created!.id, { title: "Stale Update" }, 1)),
    ).rejects.toMatchObject({ code: "CONFLICT_REVISION_MISMATCH", statusCode: 412 });
  });

  it("enforces close, reopen, and archive lifecycle transitions", async () => {
    const [current] = await runAsUser("user-a", () => cases.list(workspaceId));
    const closed = await runAsUser("user-a", () =>
      cases.transition(current!.id, "CLOSE", current!.revision),
    );
    expect(closed).toMatchObject({ status: "CLOSED", revision: 3 });
    expect(closed.closedAt).toBeInstanceOf(Date);

    await expect(
      runAsUser("user-a", () =>
        cases.update(closed.id, { title: "Closed Update" }, closed.revision),
      ),
    ).rejects.toMatchObject({ code: "CASE_NOT_MUTABLE", statusCode: 409 });

    const reopened = await runAsUser("user-a", () =>
      cases.transition(closed.id, "REOPEN", closed.revision),
    );
    expect(reopened).toMatchObject({ status: "ACTIVE", revision: 4, closedAt: null });

    const archived = await runAsUser("user-a", () =>
      cases.transition(reopened.id, "ARCHIVE", reopened.revision),
    );
    expect(archived).toMatchObject({ status: "ARCHIVED", revision: 5 });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(
      runAsUser("user-a", () =>
        cases.transition(archived.id, "REOPEN", archived.revision),
      ),
    ).rejects.toMatchObject({ code: "CASE_INVALID_STATUS_TRANSITION" });
  });

  it("rejects conflicting idempotency requests and service principals", async () => {
    await expect(
      runAsUser("user-a", () =>
        cases.create(
          {
            workspaceId,
            title: "Different Request",
            classification: "INTERNAL",
          },
          "case-create-0001",
        ),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT_IDEMPOTENCY_KEY_REUSED",
      statusCode: 409,
    });

    await expect(
      context.run(
        {
          requestId: "request-service",
          traceId: "trace-service",
          issuedAt: new Date().toISOString(),
          principal: {
            kind: "SERVICE",
            subject: "connector-worker",
            serviceId: "connector-worker",
            clientId: "connector-worker",
            issuer: "https://identity.example.test",
          },
        },
        () => cases.list(workspaceId),
      ),
    ).rejects.toMatchObject({ code: "AUTH_USER_REQUIRED", statusCode: 403 });
  });

  function createCase(idempotencyKey: string) {
    return runAsUser("user-a", () =>
      cases.create(
        {
          workspaceId,
          title: "Missing Person",
          description: "Initial assessment",
          classification: "SENSITIVE",
        },
        idempotencyKey,
      ),
    );
  }

  function runAsUser<T>(userId: string, work: () => Promise<T>): Promise<T> {
    return context.run(
      {
        requestId: `request-${userId}`,
        traceId: `trace-${userId}`,
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
});
