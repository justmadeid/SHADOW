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
import { TargetProfileModule } from "./target-profile.module.js";
import { CaseFacade } from "../case/index.js";
import { EntityFacade, IdentifierFacade } from "../entity/index.js";
import {
  AesGcmIdentifierProtection,
  IDENTIFIER_PROTECTION,
} from "../entity/infrastructure/security/identifier-protection.js";
import { SubjectFacade } from "../subject/index.js";
import { WorkspaceFacade } from "../workspace/index.js";
import { PLATFORM_DB_CLIENT } from "../../platform/database/database.module.js";
import { AuthenticationGuard } from "../../platform/auth/authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "../../platform/auth/authentication.tokens.js";
import { PlatformExceptionFilter } from "../../platform/errors/http-exception.filter.js";
import { newUuid } from "../../platform/ids/uuid.js";
import { RequestContextStore } from "../../platform/request-context/index.js";

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

describe("P2-009 Target Profile HTTP composition", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let context: RequestContextStore;
  let cases: CaseFacade;
  let entities: EntityFacade;
  let identifiers: IdentifierFacade;
  let subjects: SubjectFacade;
  let workspaces: WorkspaceFacade;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../entity/infrastructure/persistence/migrations/0001_create_entity_registry.sql",
      "../entity/infrastructure/persistence/migrations/0002_create_secure_identifiers.sql",
      "../case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../investigation/infrastructure/persistence/migrations/0001_create_investigation.sql",
      "../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "../governance/infrastructure/persistence/migrations/0003_subject_permissions.sql",
      "../governance/infrastructure/persistence/migrations/0004_workflow_run_permissions.sql",
      "../subject/infrastructure/persistence/migrations/0001_create_subject.sql",
      "../subject/infrastructure/persistence/migrations/0002_create_subject_seed.sql",
      "../subject/infrastructure/persistence/migrations/0003_subject_resolution.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );

    const module = await Test.createTestingModule({
      imports: [TargetProfileModule],
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
    cases = module.get(CaseFacade);
    entities = module.get(EntityFacade);
    identifiers = module.get(IdentifierFacade);
    subjects = module.get(SubjectFacade);
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

  it("loads an unresolved Subject without inventing identity or deferred facts", async () => {
    const fixture = await createFixture();
    const subject = await asOwner(() =>
      subjects.create(
        fixture.caseId,
        {
          subjectType: "PERSON",
          role: "PRIMARY_TARGET",
          seed: {
            fields: [
              {
                name: "USERNAME",
                value: "synthetic_private_seed",
                origin: "INVESTIGATOR_INPUT",
                classification: "SENSITIVE",
              },
            ],
          },
        },
        newUuid(),
      ),
    );

    const response = await get(fixture.caseId, subject.id).expect(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({
      id: subject.id,
      workspaceId: fixture.workspaceId,
      caseId: fixture.caseId,
      subject: { id: subject.id, status: "UNRESOLVED", entityRef: null },
      entity: null,
      identitySummary: {
        displayLabel: null,
        type: "PERSON",
        resolutionStatus: "UNRESOLVED",
        aliases: [],
        identifiers: [],
      },
      workspaceKnowledge: [],
      evidenceSummary: { total: null },
      sectionAvailability: {
        workspaceKnowledge: "NOT_IMPLEMENTED",
        evidence: "NOT_IMPLEMENTED",
      },
      availableViews: { overview: true, canvas: false, timeline: false, map: false },
      freshness: {
        mode: "CANONICAL",
        isStale: false,
        subjectRevision: 1,
        entityRevision: null,
        latestIdentifierRevision: null,
        workspaceKnowledgeUpdatedAt: null,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("synthetic_private_seed");
  });

  it("composes a resolved Entity with active fixed-mask Identifiers and performs no write", async () => {
    const fixture = await createFixture();
    const subject = await asOwner(() =>
      subjects.create(
        fixture.caseId,
        { subjectType: "PERSON", role: "PRIMARY_TARGET" },
        newUuid(),
      ),
    );
    const entity = await asOwner(() =>
      entities.create(
        fixture.workspaceId,
        { type: "PERSON", canonicalLabel: "Synthetic Canonical", aliases: ["S. Test"] },
        newUuid(),
      ),
    );
    const rawNationalId = "3201010101010001";
    const identifier = await asOwner(() =>
      identifiers.create(
        entity.id,
        { type: "NATIONAL_ID", value: rawNationalId, classification: "RESTRICTED" },
        newUuid(),
      ),
    );
    await client.db.execute(sql`UPDATE governance_role_assignments
      SET status = 'REVOKED', revision = revision + 1, revoked_at = now()
      WHERE id = ${fixture.registryAssignmentId}`);
    await client.db.execute(sql`UPDATE investigation_subjects
      SET status = 'RESOLVED', entity_id = ${entity.id}, revision = 2, updated_at = now()
      WHERE id = ${subject.id}`);
    const outboxBefore = await outboxCount();

    const response = await get(fixture.caseId, subject.id).expect(200);

    expect(response.body).toMatchObject({
      subject: {
        id: subject.id,
        status: "RESOLVED",
        entityRef: { type: "ENTITY", id: entity.id, workspaceId: fixture.workspaceId },
      },
      entity: {
        id: entity.id,
        canonicalLabel: "Synthetic Canonical",
        status: "ACTIVE",
      },
      identitySummary: {
        displayLabel: "Synthetic Canonical",
        aliases: [{ label: "S. Test" }],
        identifiers: [
          {
            id: identifier.id,
            type: "NATIONAL_ID",
            classification: "RESTRICTED",
            status: "ACTIVE",
            visibility: "MASKED",
            displayValue: "••••",
          },
        ],
      },
      freshness: {
        isStale: false,
        subjectRevision: 2,
        entityRevision: 1,
        latestIdentifierRevision: 1,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(rawNationalId);
    expect(await outboxCount()).toBe(outboxBefore);
  });

  it("binds disclosure to the exact Case and current membership", async () => {
    const first = await createFixture();
    const second = await createFixture();
    const subject = await asOwner(() =>
      subjects.create(
        first.caseId,
        { subjectType: "PERSON", role: "PRIMARY_TARGET" },
        newUuid(),
      ),
    );

    const mismatch = await get(second.caseId, subject.id).expect(404);
    const missing = await get(second.caseId, newUuid()).expect(404);
    expect(mismatch.body.error.code).toBe("TARGET_PROFILE_NOT_FOUND");
    expect(missing.body.error.code).toBe(mismatch.body.error.code);
    await get(first.caseId, subject.id, "peer").expect(404);
    await get(first.caseId, subject.id, "outsider").expect(404);
    await get(first.caseId, subject.id, "worker").expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/shadow/cases/${first.caseId}/targets/${subject.id}`)
      .expect(401);
  });

  it("follows a persisted merged Entity reference to its active canonical identity", async () => {
    const fixture = await createFixture();
    const subject = await asOwner(() =>
      subjects.create(
        fixture.caseId,
        { subjectType: "PERSON", role: "PRIMARY_TARGET" },
        newUuid(),
      ),
    );
    const canonical = await asOwner(() =>
      entities.create(
        fixture.workspaceId,
        { type: "PERSON", canonicalLabel: "Canonical Survivor" },
        newUuid(),
      ),
    );
    const legacy = await asOwner(() =>
      entities.create(
        fixture.workspaceId,
        { type: "PERSON", canonicalLabel: "Legacy Identity" },
        newUuid(),
      ),
    );
    await client.db.execute(sql`UPDATE investigation_subjects
      SET status = 'RESOLVED', entity_id = ${legacy.id}, revision = 2, updated_at = now()
      WHERE id = ${subject.id}`);
    await client.db.execute(sql`UPDATE entities
      SET status = 'MERGED', merged_into_id = ${canonical.id}, revision = 2, updated_at = now()
      WHERE id = ${legacy.id}`);

    const response = await get(fixture.caseId, subject.id).expect(200);
    expect(response.body).toMatchObject({
      subject: { entityRef: { id: canonical.id } },
      entity: {
        id: canonical.id,
        canonicalLabel: "Canonical Survivor",
        status: "ACTIVE",
      },
      identitySummary: { displayLabel: "Canonical Survivor" },
    });
    expect(JSON.stringify(response.body)).not.toContain("Legacy Identity");
  });

  it("rejects malformed resource identifiers", async () => {
    const fixture = await createFixture();
    await get("not-a-uuid", newUuid()).expect(400);
    await get(fixture.caseId, "not-a-uuid").expect(400);
  });

  async function createFixture() {
    const workspace = await asOwner(() =>
      workspaces.create(
        {
          name: "Synthetic Target Profiles",
          slug: `profiles-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
    );
    await client.db.execute(
      sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at)
        VALUES (${newUuid()}, ${workspace.id}, 'peer', 'ACTIVE', now())`,
    );
    const registryAssignmentId = await grantWorkspaceRegistryAccess(workspace.id);
    const createdCase = await asOwner(() =>
      cases.create(
        {
          workspaceId: workspace.id,
          title: "Synthetic Profile Case",
          classification: "SENSITIVE",
        },
        newUuid(),
      ),
    );
    return { workspaceId: workspace.id, caseId: createdCase.id, registryAssignmentId };
  }

  async function grantWorkspaceRegistryAccess(workspaceId: string) {
    const roleId = newUuid();
    const assignmentId = newUuid();
    await client.db.execute(sql`INSERT INTO governance_roles
      (id, workspace_id, key, name, status, revision, created_at, updated_at)
      VALUES (${roleId}, ${workspaceId}, ${`PROFILE_${roleId.replaceAll("-", "").slice(0, 12).toUpperCase()}`},
        'Target Profile synthetic role', 'ACTIVE', 1, now(), now())`);
    for (const permission of ["WORKSPACE_VIEW", "WORKSPACE_MANAGE"])
      await client.db.execute(sql`INSERT INTO governance_role_permissions
        (role_id, permission) VALUES (${roleId}, ${permission})`);
    await client.db.execute(sql`INSERT INTO governance_role_assignments
      (id, workspace_id, role_id, subject_type, subject_id, scope_type,
       scope_resource_type, scope_resource_id, status, revision,
       granted_by_subject_type, granted_by_subject_id, granted_at, case_membership)
      VALUES (${assignmentId}, ${workspaceId}, ${roleId}, 'USER', 'owner',
        'WORKSPACE', null, null, 'ACTIVE', 1, 'USER', 'owner', now(), false)`);
    return assignmentId;
  }

  async function outboxCount() {
    const result = await client.db.execute(
      sql`SELECT count(*)::int AS count FROM platform_outbox_events`,
    );
    return Number(result.rows[0]?.count);
  }

  function get(caseId: string, subjectId: string, user = "owner") {
    return request(app.getHttpServer())
      .get(`/api/v1/shadow/cases/${caseId}/targets/${subjectId}`)
      .set("authorization", `Bearer ${user}`);
  }

  function asOwner<T>(work: () => Promise<T>): Promise<T> {
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
