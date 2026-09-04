import fs from "node:fs";
import { sql } from "drizzle-orm";
import { version as uuidVersion } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  GovernanceModule,
  PolicyEnforcer,
  CaseMembershipFacade,
} from "../../../governance/index.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";

import {
  createDatabaseClient,
  DatabaseContext,
  DrizzleTransactionManager,
} from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { type Case, CaseFacade } from "../../../case/index.js";
import { type Workspace, WorkspaceFacade } from "../../../workspace/index.js";
import { PostgresOutboxStore } from "../../../../platform/events/outbox/infrastructure/persistence/postgres-outbox.store.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { InvestigationFacade } from "../../application/investigation.facade.js";
import { PostgresInvestigationRepository } from "./postgres-investigation.repository.js";

describe("Investigation persistence", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let context: RequestContextStore;
  let facade: InvestigationFacade;
  let caseA: Case;
  let caseB: Case;
  let closedCase: Case;
  let governance: TestingModule;

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
      new URL(
        "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
        import.meta.url,
      ),
      new URL("./migrations/0001_create_investigation.sql", import.meta.url),
      new URL(
        "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
        import.meta.url,
      ),
      new URL(
        "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
        import.meta.url,
      ),
    ]) {
      await client.db.execute(sql.raw(fs.readFileSync(migration, "utf8")));
    }

    const now = new Date();
    const workspaceA = workspaceFixture(newUuid(), "workspace-a", now);
    const workspaceB = workspaceFixture(newUuid(), "workspace-b", now);
    caseA = caseFixture(newUuid(), workspaceA.id, "CASE-2026-AAAAAAAAAA", "DRAFT", now);
    caseB = caseFixture(newUuid(), workspaceB.id, "CASE-2026-BBBBBBBBBB", "ACTIVE", now);
    closedCase = caseFixture(
      newUuid(),
      workspaceA.id,
      "CASE-2026-CCCCCCCCCC",
      "CLOSED",
      now,
    );

    for (const workspace of [workspaceA, workspaceB]) {
      await client.db.execute(sql`
        INSERT INTO workspaces
          (id, name, slug, status, revision, created_by_user_id, created_at, updated_at)
        VALUES
          (${workspace.id}, ${workspace.name}, ${workspace.slug}, 'ACTIVE', 1,
           'fixture-owner', ${now}, ${now})
      `);
    }
    for (const value of [caseA, caseB, closedCase]) {
      await client.db.execute(sql`
        INSERT INTO cases
          (id, code, workspace_id, title, description, status, classification,
           revision, created_by_user_id, created_at, updated_at)
        VALUES
          (${value.id}, ${value.code}, ${value.workspaceId}, ${value.title}, NULL,
           ${value.status}, 'INTERNAL', 1, 'fixture-owner', ${now}, ${now})
      `);
    }

    const workspaceRepository = {
      async createForUser(): Promise<never> {
        throw new Error("Not used by Investigation tests.");
      },
      async listForUser(userId: string): Promise<Workspace[]> {
        return userId === "user-a"
          ? [workspaceA]
          : userId === "user-b"
            ? [workspaceB]
            : [];
      },
      async findByIdForUser(id: string, userId: string): Promise<Workspace | undefined> {
        if (userId === "user-a" && id === workspaceA.id) return workspaceA;
        if (userId === "user-b" && id === workspaceB.id) return workspaceB;
        return undefined;
      },
    };
    const workspaces = new WorkspaceFacade(workspaceRepository, transactions, context);
    const caseRepository = {
      async create(): Promise<never> {
        throw new Error("Not used by Investigation tests.");
      },
      async listByWorkspace(workspaceId: string): Promise<Case[]> {
        return [caseA, caseB, closedCase].filter(
          (value) => value.workspaceId === workspaceId,
        );
      },
      async findById(id: string): Promise<Case | undefined> {
        return [caseA, caseB, closedCase].find((value) => value.id === id);
      },
      async update(): Promise<never> {
        throw new Error("Not used by Investigation tests.");
      },
      async transition(): Promise<never> {
        throw new Error("Not used by Investigation tests.");
      },
    };
    governance = await Test.createTestingModule({ imports: [GovernanceModule] })
      .overrideProvider(PLATFORM_DB_CLIENT)
      .useValue(client)
      .overrideProvider(RequestContextStore)
      .useValue(context)
      .compile();
    const membership = governance.get(CaseMembershipFacade);
    for (const parent of [caseA, caseB, closedCase]) {
      await runAsUser(parent.id === caseB.id ? "user-b" : "user-a", () =>
        transactions.run(() =>
          membership.initializeNewCase(parent.workspaceId, parent.id),
        ),
      );
    }
    const cases = new CaseFacade(
      caseRepository,
      transactions,
      context,
      workspaces,
      governance.get(PolicyEnforcer),
      membership,
    );
    const outbox = new PostgresOutboxStore(database, context);
    facade = new InvestigationFacade(
      new PostgresInvestigationRepository(database, outbox),
      transactions,
      context,
      cases,
    );
  });

  afterAll(async () => {
    await governance?.close();
    await client?.pool.end();
    await started?.container.stop();
  });

  it("creates and idempotently replays a Case-scoped UUIDv7 Investigation", async () => {
    const first = await createInvestigation("investigation-create-0001");
    const replay = await createInvestigation("investigation-create-0001");
    expect(uuidVersion(first.id)).toBe(7);
    expect(first).toMatchObject({
      workspaceId: caseA.workspaceId,
      caseId: caseA.id,
      status: "ACTIVE",
      revision: 1,
    });
    expect(replay.id).toBe(first.id);

    const counts = await client.db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM investigations) AS investigations,
        (SELECT count(*)::int FROM investigation_idempotency) AS idempotency,
        (SELECT count(*)::int FROM platform_outbox_events
          WHERE event_type = 'INVESTIGATION_CREATED') AS events
    `);
    expect(counts.rows[0]).toMatchObject({
      investigations: 1,
      idempotency: 1,
      events: 1,
    });
  });

  it("does not disclose an Investigation across Workspace access", async () => {
    const [visible] = await runAsUser("user-a", () => facade.list(caseA.id));
    await expect(
      runAsUser("user-b", () => facade.get(visible!.id)),
    ).rejects.toMatchObject({
      code: "INVESTIGATION_NOT_FOUND",
      statusCode: 404,
    });
    await expect(runAsUser("user-a", () => facade.list(caseB.id))).rejects.toMatchObject({
      code: "CASE_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("rejects a persisted Workspace and Case scope mismatch", async () => {
    const corruptId = newUuid();
    const now = new Date();
    await client.db.execute(sql`
      INSERT INTO investigations
        (id, workspace_id, case_id, title, objective, status, revision,
         created_by_user_id, created_at, updated_at)
      VALUES
        (${corruptId}, ${caseB.workspaceId}, ${caseA.id}, 'Corrupt scope',
         'Must never be disclosed', 'ACTIVE', 1, 'fixture-owner', ${now}, ${now})
    `);
    await expect(runAsUser("user-a", () => facade.get(corruptId))).rejects.toMatchObject({
      code: "INVESTIGATION_NOT_FOUND",
      statusCode: 404,
    });
    await expect(runAsUser("user-b", () => facade.get(corruptId))).rejects.toMatchObject({
      code: "INVESTIGATION_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("enforces revision and lifecycle transitions", async () => {
    const [current] = await runAsUser("user-a", () => facade.list(caseA.id));
    const paused = await runAsUser("user-a", () =>
      facade.update(current!.id, { status: "PAUSED" }, 1),
    );
    expect(paused).toMatchObject({ status: "PAUSED", revision: 2 });
    await expect(
      runAsUser("user-a", () => facade.update(paused.id, { title: "Stale" }, 1)),
    ).rejects.toMatchObject({ code: "CONFLICT_REVISION_MISMATCH", statusCode: 412 });

    const completed = await runAsUser("user-a", () =>
      facade.update(paused.id, { status: "COMPLETED" }, 2),
    );
    expect(completed.completedAt).toBeInstanceOf(Date);
    const reopened = await runAsUser("user-a", () =>
      facade.update(completed.id, { status: "ACTIVE" }, 3),
    );
    expect(reopened).toMatchObject({ status: "ACTIVE", revision: 4, completedAt: null });
    const archived = await runAsUser("user-a", () =>
      facade.update(reopened.id, { status: "ARCHIVED" }, 4),
    );
    await expect(
      runAsUser("user-a", () => facade.update(archived.id, { title: "Blocked" }, 5)),
    ).rejects.toMatchObject({ code: "INVESTIGATION_INVALID_STATUS_TRANSITION" });
  });

  it("rejects closed parent Case, conflicting replay, and service principal", async () => {
    await expect(
      runAsUser("user-a", () =>
        facade.create(
          closedCase.id,
          { title: "Late branch", objective: "Should not start" },
          "closed-case-request",
        ),
      ),
    ).rejects.toMatchObject({ code: "INVESTIGATION_PARENT_CASE_NOT_MUTABLE" });
    await expect(
      runAsUser("user-a", () =>
        facade.create(
          caseA.id,
          { title: "Different branch", objective: "Different objective" },
          "investigation-create-0001",
        ),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT_IDEMPOTENCY_KEY_REUSED" });
    await expect(
      context.run(
        {
          requestId: "request-service",
          traceId: "trace-service",
          issuedAt: new Date().toISOString(),
          principal: {
            kind: "SERVICE",
            subject: "worker",
            serviceId: "worker",
            clientId: "worker",
            issuer: "https://identity.example.test",
          },
        },
        () => facade.list(caseA.id),
      ),
    ).rejects.toMatchObject({ code: "AUTH_USER_REQUIRED", statusCode: 403 });
  });

  function createInvestigation(key: string) {
    return runAsUser("user-a", () =>
      facade.create(
        caseA.id,
        { title: "Financial trail", objective: "Establish beneficial ownership" },
        key,
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

function workspaceFixture(id: string, slug: string, now: Date): Workspace {
  return {
    id,
    name: slug,
    slug,
    status: "ACTIVE",
    settings: { locale: "id-ID", timeZone: "Asia/Jakarta" },
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function caseFixture(
  id: string,
  workspaceId: string,
  code: string,
  status: Case["status"],
  now: Date,
): Case {
  return {
    id,
    code,
    workspaceId,
    title: code,
    description: null,
    status,
    classification: "INTERNAL",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    closedAt: status === "CLOSED" ? now : null,
    archivedAt: null,
  };
}
