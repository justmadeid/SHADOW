import fs from "node:fs";
import { sql } from "drizzle-orm";
import { Test, type TestingModule } from "@nestjs/testing";
import { createDatabaseClient, DrizzleTransactionManager } from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CaseModule, CaseFacade } from "../../../case/index.js";
import { WorkspaceFacade } from "../../../workspace/index.js";
import { AuditedDataAccess, CaseMembershipFacade } from "../../../governance/index.js";
import { AuditFacade } from "../../application/audit.facade.js";
import { AUDIT_STORE } from "../../audit.tokens.js";
import type { AuditInput, AuditStore } from "../../domain/audit-event.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import { newUuid } from "../../../../platform/ids/uuid.js";

describe("P1-008 critical audit durability", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let module: TestingModule;
  let context: RequestContextStore;
  let cases: CaseFacade;
  let transactions: DrizzleTransactionManager;
  let audit: AuditFacade;
  let access: AuditedDataAccess;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "./migrations/0001_create_audit.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );
    module = await Test.createTestingModule({ imports: [CaseModule] })
      .overrideProvider(PLATFORM_DB_CLIENT)
      .useValue(client)
      .compile();
    context = module.get(RequestContextStore);
    cases = module.get(CaseFacade);
    transactions = module.get(DrizzleTransactionManager);
    audit = module.get(AuditFacade);
    access = module.get(AuditedDataAccess);
  });
  afterAll(async () => {
    await module?.close();
    await client?.pool.end();
    await started?.container.stop();
  });

  it("records actor, reason and revision once per membership transition with reference-only Outbox", async () => {
    const f = await fixture();
    await asUser("owner", () => cases.create(f.input, f.key));
    const member = await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "VIEWER", "Synthetic review"),
    );
    await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "VIEWER", "Synthetic review"),
    );
    await asUser("owner", () =>
      cases.removeMember(f.case.id, member.id, member.revision, "Synthetic removal"),
    );
    const events = await rows(f.workspaceId);
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.action === "CASE_MEMBERSHIP_REVOKED")).toEqual([
      expect.objectContaining({
        actor_type: "USER",
        actor_id: "owner",
        reason: "Synthetic removal",
        membership_id: member.id,
        resource_revision: 2,
      }),
    ]);
    for (const event of events) {
      const history = await client.db.execute(
        sql`SELECT id FROM governance_assignment_history WHERE id = ${event.operation_id}`,
      );
      expect(history.rows).toHaveLength(1);
      const outbox = await client.db.execute(
        sql`SELECT payload FROM platform_outbox_events WHERE event_type = 'AUDIT_EVENT_RECORDED' AND aggregate_id = ${event.id}`,
      );
      expect(outbox.rows).toEqual([
        { payload: { auditEventId: event.id, workspaceId: f.workspaceId } },
      ]);
    }
  });

  it.each(["audit", "outbox"])(
    "rolls back business, history and audit when %s insertion fails",
    async (target) => {
      const f = await fixture();
      const before = await snapshot(f.workspaceId);
      const table = target === "audit" ? "audit_events" : "platform_outbox_events";
      await client.db.execute(
        sql.raw(
          `CREATE FUNCTION fail_critical_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${target === "outbox" ? "IF NEW.event_type = 'AUDIT_EVENT_RECORDED' THEN" : ""} RAISE EXCEPTION 'synthetic-private-failure'; ${target === "outbox" ? "END IF;" : ""} RETURN NEW; END $$; CREATE TRIGGER fail_critical BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_critical_audit();`,
        ),
      );
      try {
        await expect(
          asUser("owner", () =>
            cases.create({ ...f.input, title: "Must roll back" }, newUuid()),
          ),
        ).rejects.toMatchObject({
          code: "AUDIT_DURABILITY_FAILED",
          statusCode: 503,
          cause: undefined,
        });
        await expect(
          asUser("owner", () =>
            cases.addMember(f.case.id, "peer", "VIEWER", "Must roll back"),
          ),
        ).rejects.toMatchObject({ code: "AUDIT_DURABILITY_FAILED" });
        expect(await snapshot(f.workspaceId)).toEqual(before);
      } finally {
        await client.db.execute(
          sql.raw(
            `DROP TRIGGER fail_critical ON ${table}; DROP FUNCTION fail_critical_audit();`,
          ),
        );
      }
    },
  );

  it("cannot commit revocation after a caller catches an application-side audit failure", async () => {
    const f = await fixture();
    const member = await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "VIEWER", "Synthetic review"),
    );
    const before = await snapshot(f.workspaceId);
    const append = vi
      .spyOn(module.get<AuditStore>(AUDIT_STORE), "append")
      .mockRejectedValueOnce(new Error("synthetic-private-failure"));
    try {
      await expect(
        asUser("owner", () =>
          transactions.run(async () => {
            await expect(
              cases.removeMember(
                f.case.id,
                member.id,
                member.revision,
                "Synthetic removal",
              ),
            ).rejects.toMatchObject({ code: "AUDIT_DURABILITY_FAILED" });
            return "caught";
          }),
        ),
      ).rejects.toThrow("Transaction marked rollback-only");
      expect(await snapshot(f.workspaceId)).toEqual(before);
    } finally {
      append.mockRestore();
    }
  });

  it("rejects UPDATE, DELETE and TRUNCATE without altering audit evidence", async () => {
    const f = await fixture();
    const before = await rows(f.workspaceId);
    for (const statement of [
      sql`UPDATE audit_events SET reason = 'changed' WHERE workspace_id = ${f.workspaceId}`,
      sql`DELETE FROM audit_events WHERE workspace_id = ${f.workspaceId}`,
      sql.raw("TRUNCATE audit_events"),
    ]) {
      await expect(client.db.execute(statement)).rejects.toThrow();
      expect(await rows(f.workspaceId)).toEqual(before);
    }
  });

  it("deduplicates concurrent identical operations, rejects changed content and retains the original actor", async () => {
    const f = await fixture();
    const input: AuditInput = {
      operationId: newUuid(),
      action: "EVIDENCE_EXPORT_AUTHORIZATION",
      outcome: "AUTHORIZED",
      resource: {
        type: "CASE",
        id: f.case.id,
        caseId: f.case.id,
        workspaceId: f.workspaceId,
      },
      classification: "SENSITIVE",
      reason: "Synthetic review",
    };
    const ids = await Promise.all(
      [1, 2].map(() =>
        asUser("owner", () => transactions.run(() => audit.record(input))),
      ),
    );
    expect(ids[0]).toBe(ids[1]);
    await expect(
      asUser("owner", () =>
        transactions.run(() => audit.record({ ...input, reason: "Different" })),
      ),
    ).rejects.toMatchObject({ code: "AUDIT_OPERATION_CONFLICT" });
    await expect(
      asUser("peer", () => transactions.run(() => audit.record(input))),
    ).rejects.toMatchObject({ code: "AUDIT_OPERATION_CONFLICT" });
    expect(
      (await rows(f.workspaceId)).filter((e) => e.operation_id === input.operationId),
    ).toHaveLength(1);
  });

  it("commits sensitive disclosure audit before returning the value and reauthorizes retries after revocation", async () => {
    const f = await fixture();
    await permission(f.workspaceId, "IDENTIFIER_VIEW_RESTRICTED");
    const operation = { operationId: newUuid() };
    const load = vi.fn(async () => {
      // A separate connection cannot see the pending audit while the loader runs.
      expect(
        (await rows(f.workspaceId)).filter(
          (e) => e.operation_id === operation.operationId,
        ),
      ).toHaveLength(0);
      return { value: "synthetic-sensitive-value" };
    });
    const result = await asUser("owner", () =>
      access.display(display(f), operation, load),
    );
    expect(result).toMatchObject({
      visibility: "FULL",
      displayValue: "synthetic-sensitive-value",
    });
    expect(
      (await rows(f.workspaceId)).filter((e) => e.operation_id === operation.operationId),
    ).toEqual([
      expect.objectContaining({ outcome: "AUTHORIZED", action: "SENSITIVE_FIELD_VIEW" }),
    ]);
    await asUser("owner", () => cases.addMember(f.case.id, "peer", "OWNER", "Transfer"));
    const owner = await client.db.execute(
      sql`SELECT id, revision FROM governance_role_assignments WHERE scope_resource_id = ${f.case.id} AND subject_id = 'owner' AND case_membership`,
    );
    await asUser("peer", () =>
      cases.removeMember(
        f.case.id,
        String(owner.rows[0]!.id),
        Number(owner.rows[0]!.revision),
        "Revoke",
      ),
    );
    const denied = await asUser("owner", () =>
      access.display(display(f), operation, load),
    );
    expect(denied.visibility).toBe("HIDDEN");
    expect(load).toHaveBeenCalledTimes(1);
    expect(
      (await rows(f.workspaceId))
        .filter((e) => e.operation_id === operation.operationId)
        .map((e) => e.outcome)
        .sort(),
    ).toEqual(["AUTHORIZED", "DENIED"]);
  });

  it("rechecks policy after a competing membership revocation commits", async () => {
    const f = await fixture();
    await permission(f.workspaceId, "IDENTIFIER_VIEW_RESTRICTED");
    const peer = await asUser("owner", () =>
      cases.addMember(f.case.id, "peer", "OWNER", "Synthetic review"),
    );
    const memberships = module.get(CaseMembershipFacade);
    const original = memberships.lockCase.bind(memberships);
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const lock = vi
      .spyOn(memberships, "lockCase")
      .mockImplementationOnce(async (...args) => {
        entered();
        await release;
        await original(...args);
      });
    const load = vi.fn(async () => ({ value: "synthetic-sensitive-value" }));
    const pending = asUser("peer", () =>
      access.display(display(f), { operationId: newUuid() }, load),
    );
    try {
      await started;
      await asUser("owner", () =>
        cases.removeMember(f.case.id, peer.id, peer.revision, "Synthetic revoke"),
      );
    } finally {
      resume();
      lock.mockRestore();
    }
    expect((await pending).visibility).toBe("HIDDEN");
    expect(load).not.toHaveBeenCalled();
  });

  it("does not load masked fields and emits only match status for use-only grants", async () => {
    const f = await fixture();
    const load = vi.fn(async () => ({
      value: "synthetic-sensitive-value",
      matchStatus: "EXACT_MATCH" as const,
    }));
    expect(
      (
        await asUser("owner", () =>
          access.display(display(f), { operationId: newUuid() }, load),
        )
      ).visibility,
    ).toBe("MASKED");
    expect(load).not.toHaveBeenCalled();
    await permission(f.workspaceId, "IDENTIFIER_USE_RESTRICTED");
    const result = await asUser("owner", () =>
      access.display(display(f), { operationId: newUuid() }, load),
    );
    expect(result).toMatchObject({
      visibility: "MATCH_ONLY",
      matchStatus: "EXACT_MATCH",
    });
    expect(result).not.toHaveProperty("value");
    expect(result).not.toHaveProperty("displayValue");
    expect(
      (await rows(f.workspaceId)).some((e) => e.action === "SENSITIVE_FIELD_MATCH"),
    ).toBe(true);
  });

  it("fails closed before loading on audit failure, sanitizes loader failure and rejects ambient transactions", async () => {
    const f = await fixture();
    await permission(f.workspaceId, "IDENTIFIER_VIEW_RESTRICTED");
    const before = await rows(f.workspaceId);
    const load = vi.fn(async () => ({ value: "synthetic-sensitive-value" }));
    const append = vi
      .spyOn(module.get<AuditStore>(AUDIT_STORE), "append")
      .mockRejectedValueOnce(new Error("synthetic-private-failure"));
    try {
      await expect(
        asUser("owner", () =>
          access.display(display(f), { operationId: newUuid() }, load),
        ),
      ).rejects.toMatchObject({ code: "AUDIT_DURABILITY_FAILED" });
    } finally {
      append.mockRestore();
    }
    expect(load).not.toHaveBeenCalled();
    await expect(
      asUser("owner", () =>
        access.display(display(f), { operationId: newUuid() }, async () => {
          throw new Error("synthetic-private-failure");
        }),
      ),
    ).rejects.toMatchObject({ code: "AUDIT_DISCLOSURE_LOAD_FAILED", cause: undefined });
    await expect(
      asUser("owner", () =>
        transactions.run(() =>
          access.display(display(f), { operationId: newUuid() }, load),
        ),
      ),
    ).rejects.toMatchObject({ code: "AUDIT_RELEASE_BOUNDARY_REQUIRED" });
    expect(await rows(f.workspaceId)).toEqual(before);
  });

  it("persists allowed and denied export/source authorization without claiming external execution", async () => {
    const f = await fixture();
    const input = display(f);
    const denied = await asUser("owner", () =>
      access.authorizeExport(input, { operationId: newUuid() }),
    );
    expect(denied.allowed).toBe(false);
    await permission(f.workspaceId, "EVIDENCE_EXPORT");
    await permission(f.workspaceId, "IDENTIFIER_USE_RESTRICTED");
    const exported = await asUser("owner", () =>
      access.authorizeExport(
        {
          ...input,
          policy: {
            enabled: true,
            sensitivePermission: "IDENTIFIER_USE_RESTRICTED",
            redacted: true,
          },
        },
        { operationId: newUuid() },
      ),
    );
    expect(exported.allowed).toBe(true);
    const source = await asUser("owner", () =>
      access.authorizeSource(
        {
          ...input,
          policy: {
            enabled: true,
            usePermission: "CASE_VIEW",
            restrictedPermission: "IDENTIFIER_USE_RESTRICTED",
            rawPersistence: "SOURCE_POLICY",
          },
        },
        { operationId: newUuid() },
      ),
    );
    expect(source).toMatchObject({ allowed: true, rawPersistence: "DISABLED" });
    const events = (await rows(f.workspaceId)).filter((e) =>
      [denied.auditEventId, exported.auditEventId, source.auditEventId].includes(
        String(e.id),
      ),
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.outcome).sort()).toEqual([
      "AUTHORIZED",
      "AUTHORIZED",
      "DENIED",
    ]);
  });

  async function fixture() {
    const workspace = await asUser("owner", () =>
      module.get(WorkspaceFacade).create(
        {
          name: "Audit test",
          slug: `audit-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
    );
    await client.db.execute(
      sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at) VALUES (${newUuid()}, ${workspace.id}, 'peer', 'ACTIVE', now())`,
    );
    const input = {
      workspaceId: workspace.id,
      title: "Synthetic audit case",
      classification: "SENSITIVE" as const,
    };
    const key = newUuid();
    return {
      workspaceId: workspace.id,
      input,
      key,
      case: await asUser("owner", () => cases.create(input, key)),
    };
  }
  function display(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      classification: "RESTRICTED" as const,
      fieldKind: "IDENTIFIER" as const,
      access: {
        action: "CASE_VIEW" as const,
        resource: { type: "CASE" as const, id: f.case.id, workspaceId: f.workspaceId },
        context: {
          caseMembershipRequired: true,
          caseId: f.case.id,
          reasonForAccess: "Synthetic review",
        },
      },
    };
  }
  async function permission(workspaceId: string, permission: string) {
    await client.db.execute(
      sql`INSERT INTO governance_role_permissions (role_id, permission) SELECT id, ${permission} FROM governance_roles WHERE workspace_id = ${workspaceId} AND case_role = 'OWNER' ON CONFLICT DO NOTHING`,
    );
  }
  async function rows(workspaceId: string) {
    return (
      await client.db.execute(
        sql`SELECT * FROM audit_events WHERE workspace_id = ${workspaceId} ORDER BY id`,
      )
    ).rows;
  }
  async function snapshot(workspaceId: string) {
    const result: Record<string, unknown> = {};
    for (const table of [
      "cases",
      "governance_role_assignments",
      "governance_assignment_history",
      "audit_events",
    ])
      result[table] = (
        await client.db.execute(
          sql`SELECT * FROM ${sql.identifier(table)} WHERE workspace_id = ${workspaceId} ORDER BY 1`,
        )
      ).rows;
    result.idempotency = (
      await client.db.execute(
        sql`SELECT * FROM case_idempotency ORDER BY user_id, idempotency_key`,
      )
    ).rows;
    result.outbox = (
      await client.db.execute(
        sql`SELECT * FROM platform_outbox_events WHERE payload->>'workspaceId' = ${workspaceId} ORDER BY id`,
      )
    ).rows;
    return result;
  }
  function asUser<T>(userId: string, work: () => Promise<T>) {
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
});
