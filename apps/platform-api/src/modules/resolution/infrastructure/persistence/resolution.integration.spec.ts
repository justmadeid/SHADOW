import { createHash } from "node:crypto";
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { AccessTokenVerifier } from "@intelligence/auth";
import { createDatabaseClient, DrizzleTransactionManager } from "@intelligence/database";
import { startPostgresTestContainer } from "@intelligence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Logger } from "pino";
import { CaseFacade } from "../../../case/index.js";
import { SubjectFacade } from "../../../subject/index.js";
import { WorkspaceFacade } from "../../../workspace/index.js";
import { PLATFORM_DB_CLIENT } from "../../../../platform/database/database.module.js";
import { ACCESS_TOKEN_VERIFIER } from "../../../../platform/auth/authentication.tokens.js";
import { AuthenticationGuard } from "../../../../platform/auth/authentication.guard.js";
import { PlatformExceptionFilter } from "../../../../platform/errors/http-exception.filter.js";
import { newUuid } from "../../../../platform/ids/uuid.js";
import { RequestContextStore } from "../../../../platform/request-context/index.js";
import type { InvestigationSubject } from "../../../subject/index.js";
import { RESOLUTION_REPOSITORY } from "../../domain/resolution-repository.js";
import type { ResolutionRepository } from "../../domain/resolution-repository.js";
import { ResolutionModule } from "../../resolution.module.js";

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

describe("P2-005 Resolution HTTP and PostgreSQL", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let context: RequestContextStore;
  let transactions: DrizzleTransactionManager;
  let repository: ResolutionRepository;
  let workspaces: WorkspaceFacade;
  let cases: CaseFacade;
  let subjects: SubjectFacade;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../../../entity/infrastructure/persistence/migrations/0001_create_entity_registry.sql",
      "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../../../investigation/infrastructure/persistence/migrations/0001_create_investigation.sql",
      "../../../subject/infrastructure/persistence/migrations/0001_create_subject.sql",
      "../../../subject/infrastructure/persistence/migrations/0002_create_subject_seed.sql",
      "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "../../../governance/infrastructure/persistence/migrations/0003_subject_permissions.sql",
      "./migrations/0001_create_resolution.sql",
    ])
      await client.db.execute(
        sql.raw(fs.readFileSync(new URL(migration, import.meta.url), "utf8")),
      );
    const module = await Test.createTestingModule({
      imports: [ResolutionModule],
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
    transactions = module.get(DrizzleTransactionManager);
    repository = module.get(RESOLUTION_REPOSITORY);
    workspaces = module.get(WorkspaceFacade);
    cases = module.get(CaseFacade);
    subjects = module.get(SubjectFacade);
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

  it("persists an idempotent review session and metadata-only Outbox event", async () => {
    const subject = await fixture();
    const key = newUuid();
    const first = await createSession(subject, key);
    const replay = await createSession(subject, key);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      subjectId: subject.id,
      workspaceId: subject.workspaceId,
      caseId: subject.caseId,
      status: "SEARCHING",
      candidatesCount: 0,
      selectedCandidateId: null,
      resolutionDecisionId: null,
      revision: 1,
    });
    const response = await get(`/resolutions/${first.id}`).expect(200);
    expect(response.body).toEqual(first);
    expect(response.headers.etag).toBe('"1"');
    const event = await client.db.execute(
      sql`SELECT payload FROM platform_outbox_events WHERE aggregate_id = ${first.id}`,
    );
    expect(event.rows).toHaveLength(1);
    expect(JSON.stringify(event.rows)).not.toContain("displayLabel");
    await expect(
      createSession({ ...subject, caseId: newUuid() }, key),
    ).rejects.toMatchObject({ code: "CONFLICT_IDEMPOTENCY_KEY_REUSED" });
  });

  it("adds source-linked Candidates idempotently without creating an Entity", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const evidenceId = newUuid();
    const key = newUuid();
    const input = {
      type: "PERSON" as const,
      displayLabel: "Synthetic Candidate",
      classification: "SENSITIVE" as const,
      source: {
        origin: "EVIDENCE" as const,
        resource: {
          type: "EVIDENCE" as const,
          id: evidenceId,
          workspaceId: subject.workspaceId,
          caseId: subject.caseId,
        },
      },
      evidenceRefs: [
        {
          type: "EVIDENCE" as const,
          id: evidenceId,
          workspaceId: subject.workspaceId,
          caseId: subject.caseId,
        },
      ],
    };
    const first = await addCandidate(subject, session.id, key, input);
    const replay = await addCandidate(subject, session.id, key, input);
    expect(replay.candidate.id).toBe(first.candidate.id);
    expect(first.session).toMatchObject({ status: "NEEDS_REVIEW", revision: 2 });
    expect(first.candidate).toMatchObject({
      status: "PENDING_REVIEW",
      source: { origin: "EVIDENCE" },
      evidenceRefs: [{ id: evidenceId }],
    });
    expect(first.candidate).not.toHaveProperty("entityId");
    expect(
      (
        await client.db.execute(
          sql`SELECT id FROM entities WHERE workspace_id = ${subject.workspaceId}`,
        )
      ).rows,
    ).toHaveLength(0);
    const detail = await get(`/candidates/${first.candidate.id}`).expect(200);
    expect(detail.body).toEqual(first.candidate);
    expect(detail.headers.etag).toBe('"1"');
    const page = await get(`/resolutions/${session.id}/candidates`).expect(200);
    expect(page.body.items).toEqual([first.candidate]);
    const outbox = await client.db.execute(
      sql`SELECT payload FROM platform_outbox_events WHERE aggregate_id IN (${session.id}, ${first.candidate.id})`,
    );
    expect(JSON.stringify(outbox.rows)).not.toContain("Synthetic Candidate");
    expect(JSON.stringify(outbox.rows)).not.toContain(evidenceId);
    await expect(
      addCandidate(subject, session.id, key, { ...input, displayLabel: "Different" }),
    ).rejects.toMatchObject({ code: "CONFLICT_IDEMPOTENCY_KEY_REUSED" });
  });

  it("hides inaccessible sessions and Candidates and rechecks revoked membership", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const value = await addCandidate(subject, session.id);
    await request(app.getHttpServer())
      .get(`/api/v1/resolutions/${session.id}`)
      .expect(401);
    await get(`/resolutions/${session.id}`, "worker").expect(403);
    for (const user of ["viewer", "outsider"]) {
      await get(`/resolutions/${session.id}`, user).expect(404);
      await get(`/candidates/${value.candidate.id}`, user).expect(404);
    }
    const membership = await asOwner(() =>
      cases.addMember(subject.caseId, "viewer", "VIEWER", "Resolution review"),
    );
    await get(`/resolutions/${session.id}`, "viewer").expect(200);
    await get(`/candidates/${value.candidate.id}`, "viewer").expect(200);
    await asOwner(() =>
      cases.removeMember(
        subject.caseId,
        membership.id,
        membership.revision,
        "Resolution access revoked",
      ),
    );
    await get(`/resolutions/${session.id}`, "viewer").expect(404);
  });

  it("paginates with a session-bound cursor and rejects query abuse", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const first = await addCandidate(subject, session.id);
    await addCandidate(subject, session.id);
    const page = (await get(`/resolutions/${session.id}/candidates?limit=1`).expect(200))
      .body;
    expect(page).toMatchObject({ page: { hasMore: true } });
    const next = (
      await get(
        `/resolutions/${session.id}/candidates?limit=1&cursor=${page.page.nextCursor}`,
      ).expect(200)
    ).body;
    expect(next.items[0].id).toBe(first.candidate.id);
    const otherSubject = await fixture();
    const other = await createSession(otherSubject);
    await get(
      `/resolutions/${other.id}/candidates?cursor=${page.page.nextCursor}`,
    ).expect(400);
    await get(`/resolutions/${session.id}/candidates?limit=101`).expect(400);
    await get(`/resolutions/${session.id}/candidates?workspaceId=${newUuid()}`).expect(
      400,
    );
  });

  it("fails closed on invalid source scope and exposes no premature mutations", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const otherSubject = await fixture();
    await expect(
      addCandidate(subject, session.id, newUuid(), {
        type: "PERSON",
        displayLabel: "Cross scope",
        classification: "INTERNAL",
        source: {
          origin: "EVIDENCE",
          resource: {
            type: "EVIDENCE",
            id: newUuid(),
            workspaceId: newUuid(),
            caseId: subject.caseId,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_CANDIDATE_INVALID" });
    await expect(
      client.db.execute(sql`INSERT INTO resolution_sessions
        (id, subject_id, workspace_id, case_id, status, candidates_count,
         selected_candidate_id, resolution_decision_id, revision, created_by_user_id,
         created_at, updated_at)
        VALUES (${newUuid()}, ${otherSubject.id}, ${subject.workspaceId}, ${subject.caseId},
          'SEARCHING', 0, NULL, NULL, 1, 'owner', now(), now())`),
    ).rejects.toThrow();
    await request(app.getHttpServer())
      .post(`/api/v1/subjects/${subject.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/candidates/${newUuid()}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .send({ decision: "CREATE_NEW" })
      .expect(404);
  });

  it("rolls back Candidate, session revision, history and replay when Outbox fails", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const key = newUuid();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_candidate_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'CANDIDATE_CREATED' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_candidate_event BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_candidate_event();`,
      ),
    );
    try {
      await expect(addCandidate(subject, session.id, key)).rejects.toThrow();
      expect(
        (
          await client.db.execute(
            sql`SELECT id FROM candidates WHERE resolution_session_id = ${session.id}`,
          )
        ).rows,
      ).toHaveLength(0);
      expect((await repository.findSession(session.id))?.revision).toBe(1);
      expect(
        (
          await client.db.execute(
            sql`SELECT candidate_id FROM candidate_idempotency WHERE idempotency_key = ${key}`,
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_candidate_event ON platform_outbox_events; DROP FUNCTION fail_candidate_event();",
        ),
      );
    }
    await addCandidate(subject, session.id, key);
  });

  it("keeps Candidate provenance immutable and lifecycle history append-only", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const evidenceId = newUuid();
    const value = await addCandidate(subject, session.id, newUuid(), {
      type: "PERSON",
      displayLabel: "Append-only Candidate",
      classification: "INTERNAL",
      source: { origin: "INVESTIGATOR_INPUT", resource: null },
      evidenceRefs: [
        {
          type: "EVIDENCE",
          id: evidenceId,
          workspaceId: subject.workspaceId,
          caseId: subject.caseId,
        },
      ],
    });
    const decisionId = newUuid();
    await client.db.execute(sql`INSERT INTO resolution_decisions
      (id, resolution_session_id, candidate_id, decision, target_entity_id,
       reason_code, decided_by_user_id, decided_at)
      VALUES (${decisionId}, ${session.id}, ${value.candidate.id}, 'REJECT', NULL,
        'NOT_SAME_IDENTITY', 'owner', now())`);
    await expect(
      client.db.execute(
        sql`UPDATE resolution_decisions SET reason_code = 'MANUAL_REVIEW' WHERE id = ${decisionId}`,
      ),
    ).rejects.toThrow();
    await expect(
      client.db.execute(
        sql`DELETE FROM candidate_revisions WHERE candidate_id = ${value.candidate.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      client.db.execute(
        sql`DELETE FROM candidate_evidence_refs WHERE candidate_id = ${value.candidate.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      client.db.execute(
        sql`UPDATE candidates SET display_label = 'Rewritten identity'
          WHERE id = ${value.candidate.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      client.db.execute(
        sql`UPDATE resolution_sessions SET created_by_user_id = 'rewritten'
          WHERE id = ${session.id}`,
      ),
    ).rejects.toThrow();
  });

  async function fixture(): Promise<InvestigationSubject> {
    const workspace = await asOwner(() =>
      workspaces.create(
        {
          name: "Synthetic Resolution",
          slug: `resolution-${newUuid()}`,
          locale: "id-ID",
          timeZone: "Asia/Jakarta",
        },
        newUuid(),
      ),
    );
    await client.db.execute(
      sql`INSERT INTO workspace_members (id, workspace_id, user_id, status, joined_at)
        VALUES (${newUuid()}, ${workspace.id}, 'viewer', 'ACTIVE', now())`,
    );
    const parent = await asOwner(() =>
      cases.create(
        {
          workspaceId: workspace.id,
          title: "Synthetic Resolution Case",
          classification: "SENSITIVE",
        },
        newUuid(),
      ),
    );
    return asOwner(() =>
      subjects.create(
        parent.id,
        { subjectType: "PERSON", role: "PRIMARY_TARGET" },
        newUuid(),
      ),
    );
  }

  function createSession(subject: InvestigationSubject, key = newUuid()) {
    return asOwner(() =>
      transactions.run(() =>
        repository.createSession({
          workspaceId: subject.workspaceId,
          caseId: subject.caseId,
          subjectId: subject.id,
          actorUserId: "owner",
          idempotencyKey: key,
          requestHash: createHash("sha256")
            .update(`${subject.workspaceId}:${subject.caseId}:${subject.id}`)
            .digest("hex"),
        }),
      ),
    );
  }

  function addCandidate(
    subject: InvestigationSubject,
    resolutionSessionId: string,
    key = newUuid(),
    input: Parameters<ResolutionRepository["addCandidate"]>[0] extends infer T
      ? Omit<
          Extract<T, object>,
          | "resolutionSessionId"
          | "subjectId"
          | "subjectType"
          | "workspaceId"
          | "caseId"
          | "producerType"
          | "producerId"
          | "idempotencyKey"
        >
      : never = {
      type: "PERSON",
      displayLabel: "Synthetic Candidate",
      classification: "INTERNAL",
      source: { origin: "INVESTIGATOR_INPUT", resource: null },
    },
  ) {
    return asOwner(() =>
      transactions.run(() =>
        repository.addCandidate({
          ...input,
          resolutionSessionId,
          subjectId: subject.id,
          subjectType: subject.subjectType,
          workspaceId: subject.workspaceId,
          caseId: subject.caseId,
          producerType: "USER",
          producerId: "owner",
          idempotencyKey: key,
        }),
      ),
    );
  }

  function get(path: string, user = "owner") {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
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
