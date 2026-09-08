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
import { EntityFacade, IdentifierFacade } from "../../../entity/index.js";
import type { Permission } from "../../../governance/index.js";
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
import { ResolutionMatchFacade } from "../../application/resolution-match.facade.js";
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

describe("P2-005 through P2-008 Resolution HTTP and PostgreSQL", () => {
  let started: Awaited<ReturnType<typeof startPostgresTestContainer>>;
  let client: ReturnType<typeof createDatabaseClient>;
  let app: INestApplication;
  let context: RequestContextStore;
  let transactions: DrizzleTransactionManager;
  let repository: ResolutionRepository;
  let workspaces: WorkspaceFacade;
  let cases: CaseFacade;
  let entities: EntityFacade;
  let identifiers: IdentifierFacade;
  let subjects: SubjectFacade;
  let matches: ResolutionMatchFacade;

  beforeAll(async () => {
    started = await startPostgresTestContainer();
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("DATABASE_URL", started.databaseUrl);
    vi.stubEnv("OIDC_ISSUER", "https://identity.example.test");
    vi.stubEnv("OIDC_AUDIENCE", "platform-api-test");
    vi.stubEnv("OIDC_JWKS_URI", "https://identity.example.test/.well-known/jwks.json");
    vi.stubEnv("IDENTIFIER_ENCRYPTION_KEY_ID", "test-encryption-v1");
    vi.stubEnv(
      "IDENTIFIER_ENCRYPTION_KEY_BASE64",
      Buffer.alloc(32, 1).toString("base64"),
    );
    vi.stubEnv("IDENTIFIER_FINGERPRINT_KEY_ID", "test-fingerprint-v1");
    vi.stubEnv(
      "IDENTIFIER_FINGERPRINT_KEY_BASE64",
      Buffer.alloc(32, 2).toString("base64"),
    );
    client = createDatabaseClient({ databaseUrl: started.databaseUrl, maxPoolSize: 8 });
    for (const migration of [
      "../../../audit/infrastructure/persistence/migrations/0001_create_audit.sql",
      "../../../audit/infrastructure/persistence/migrations/0002_candidate_resolution_action.sql",
      "../../../../platform/events/outbox/infrastructure/persistence/migrations/0001_create_platform_outbox.sql",
      "../../../workspace/infrastructure/persistence/migrations/0001_create_workspace.sql",
      "../../../entity/infrastructure/persistence/migrations/0001_create_entity_registry.sql",
      "../../../entity/infrastructure/persistence/migrations/0002_create_secure_identifiers.sql",
      "../../../case/infrastructure/persistence/migrations/0001_create_case.sql",
      "../../../investigation/infrastructure/persistence/migrations/0001_create_investigation.sql",
      "../../../subject/infrastructure/persistence/migrations/0001_create_subject.sql",
      "../../../subject/infrastructure/persistence/migrations/0002_create_subject_seed.sql",
      "../../../subject/infrastructure/persistence/migrations/0003_subject_resolution.sql",
      "../../../governance/infrastructure/persistence/migrations/0001_create_governance.sql",
      "../../../governance/infrastructure/persistence/migrations/0002_case_membership.sql",
      "../../../governance/infrastructure/persistence/migrations/0003_subject_permissions.sql",
      "./migrations/0001_create_resolution.sql",
      "./migrations/0002_create_matching_signals.sql",
      "./migrations/0003_atomic_candidate_resolution.sql",
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
    entities = module.get(EntityFacade);
    identifiers = module.get(IdentifierFacade);
    subjects = module.get(SubjectFacade);
    matches = module.get(ResolutionMatchFacade);
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
    vi.unstubAllEnvs();
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

  it("starts resolution and atomically creates a canonical Entity from a Candidate", async () => {
    const original = await fixture();
    const startKey = newUuid();
    const startedResolution = await request(app.getHttpServer())
      .post(`/api/v1/subjects/${original.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", startKey)
      .expect(202);
    expect(startedResolution.body.subject).toMatchObject({
      id: original.id,
      status: "RESOLVING",
      revision: 2,
    });
    expect(startedResolution.headers.location).toBe(
      `/api/v1/resolutions/${startedResolution.body.resolution.id}`,
    );
    const startReplay = await request(app.getHttpServer())
      .post(`/api/v1/subjects/${original.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", startKey)
      .expect(202);
    expect(startReplay.body.resolution.id).toBe(startedResolution.body.resolution.id);

    const added = await addCandidate(
      original,
      startedResolution.body.resolution.id,
      newUuid(),
      {
        type: "PERSON",
        displayLabel: "Synthetic Canonical Person",
        classification: "SENSITIVE",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
    );
    const key = newUuid();
    const operationId = newUuid();
    const decision = await request(app.getHttpServer())
      .post(`/api/v1/candidates/${added.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", key)
      .set("x-audit-operation-id", operationId)
      .send({ decision: "CREATE_NEW", reasonCode: "MANUAL_REVIEW" })
      .expect(200);
    expect(decision.body).toMatchObject({
      candidate: { id: added.candidate.id, status: "RESOLVED", revision: 2 },
      resolution: { status: "RESOLVED", revision: 3 },
      subject: { status: "RESOLVED", revision: 3 },
      decision: { decision: "CREATE_NEW", reasonCode: "MANUAL_REVIEW" },
    });
    expect(decision.body.subject.entityRef.id).toBe(
      decision.body.decision.targetEntityId,
    );
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/candidates/${added.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", key)
      .set("x-audit-operation-id", operationId)
      .send({ decision: "CREATE_NEW", reasonCode: "MANUAL_REVIEW" })
      .expect(200);
    expect(replay.body.decision.id).toBe(decision.body.decision.id);
    await request(app.getHttpServer())
      .post(`/api/v1/candidates/${added.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", key)
      .set("x-audit-operation-id", operationId)
      .send({
        decision: "CREATE_NEW",
        reasonCode: "MULTIPLE_SUPPORTING_SIGNALS",
      })
      .expect(409);
    expect(
      (
        await client.db.execute(sql`SELECT id FROM entities
          WHERE workspace_id = ${original.workspaceId}
            AND canonical_label = 'Synthetic Canonical Person'`)
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.db.execute(sql`SELECT resource_type, resource_id FROM audit_events
          WHERE operation_id = ${operationId} AND action = 'CANDIDATE_RESOLUTION'`)
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.db.execute(sql`SELECT resource_type, resource_id FROM audit_events
          WHERE operation_id = ${operationId} AND action = 'CANDIDATE_RESOLUTION'`)
      ).rows[0],
    ).toMatchObject({
      resource_type: "CANDIDATE",
      resource_id: added.candidate.id,
    });
  });

  it("rolls back every resolution write when critical audit persistence fails", async () => {
    const original = await fixture();
    const start = await request(app.getHttpServer())
      .post(`/api/v1/subjects/${original.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .expect(202);
    const added = await addCandidate(original, start.body.resolution.id, newUuid(), {
      type: "PERSON",
      displayLabel: "Synthetic Rollback Person",
      classification: "INTERNAL",
      source: { origin: "INVESTIGATOR_INPUT", resource: null },
    });
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_resolution_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'CANDIDATE_RESOLUTION' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_resolution_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_resolution_audit();`,
      ),
    );
    const key = newUuid();
    const operationId = newUuid();
    try {
      await request(app.getHttpServer())
        .post(`/api/v1/candidates/${added.candidate.id}/actions/resolve`)
        .set("authorization", "Bearer owner")
        .set("if-match", '"1"')
        .set("idempotency-key", key)
        .set("x-audit-operation-id", operationId)
        .send({ decision: "CREATE_NEW", reasonCode: "MANUAL_REVIEW" })
        .expect(503);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_resolution_audit ON audit_events; DROP FUNCTION fail_resolution_audit();",
        ),
      );
    }
    expect(await asOwner(() => subjects.get(original.id))).toMatchObject({
      status: "RESOLVING",
      revision: 2,
      entityRef: null,
    });
    expect(await repository.findCandidate(added.candidate.id)).toMatchObject({
      status: "PENDING_REVIEW",
      revision: 1,
    });
    expect(await repository.findSession(start.body.resolution.id)).toMatchObject({
      status: "NEEDS_REVIEW",
      revision: 2,
    });
    expect(
      (
        await client.db.execute(sql`SELECT id FROM entities
          WHERE canonical_label = 'Synthetic Rollback Person'`)
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await client.db.execute(sql`SELECT id FROM resolution_decisions
        WHERE candidate_id = ${added.candidate.id}`)
      ).rows,
    ).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`/api/v1/candidates/${added.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", key)
      .set("x-audit-operation-id", operationId)
      .send({ decision: "CREATE_NEW", reasonCode: "MANUAL_REVIEW" })
      .expect(200);
  });

  it("links a compatible existing Entity and rejects restricted canonical creation", async () => {
    const linkSubject = await fixture();
    await grantWorkspaceManage(linkSubject.workspaceId);
    const target = await createEntity(linkSubject.workspaceId, "PERSON");
    const linkStart = await request(app.getHttpServer())
      .post(`/api/v1/subjects/${linkSubject.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .expect(202);
    const linkCandidate = await addCandidate(linkSubject, linkStart.body.resolution.id);
    const linked = await request(app.getHttpServer())
      .post(`/api/v1/candidates/${linkCandidate.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .set("x-audit-operation-id", newUuid())
      .send({
        decision: "LINK_EXISTING",
        entityId: target.id,
        reasonCode: "EXACT_IDENTIFIER_MATCH",
      })
      .expect(200);
    expect(linked.body.subject.entityRef.id).toBe(target.id);

    const restrictedSubject = await fixture();
    const restrictedStart = await request(app.getHttpServer())
      .post(`/api/v1/subjects/${restrictedSubject.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .expect(202);
    const restricted = await addCandidate(
      restrictedSubject,
      restrictedStart.body.resolution.id,
      newUuid(),
      {
        type: "PERSON",
        displayLabel: null,
        classification: "RESTRICTED",
        source: { origin: "INVESTIGATOR_INPUT", resource: null },
      },
    );
    await request(app.getHttpServer())
      .post(`/api/v1/candidates/${restricted.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .set("x-audit-operation-id", newUuid())
      .send({ decision: "CREATE_NEW", reasonCode: "MANUAL_REVIEW" })
      .expect(409);
    expect(await repository.findCandidate(restricted.candidate.id)).toMatchObject({
      status: "PENDING_REVIEW",
      revision: 1,
    });
  });

  it("keeps resolving after REJECT and fails only after the last UNCERTAIN Candidate", async () => {
    const original = await fixture();
    const start = await request(app.getHttpServer())
      .post(`/api/v1/subjects/${original.id}/actions/start-resolution`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .expect(202);
    const first = await addCandidate(original, start.body.resolution.id);
    const second = await addCandidate(original, start.body.resolution.id);
    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/candidates/${first.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .set("x-audit-operation-id", newUuid())
      .send({ decision: "REJECT", reasonCode: "NOT_SAME_IDENTITY" })
      .expect(200);
    expect(rejected.body).toMatchObject({
      candidate: { status: "REJECTED" },
      resolution: { status: "NEEDS_REVIEW" },
      subject: { status: "RESOLVING", revision: 2 },
    });
    const uncertain = await request(app.getHttpServer())
      .post(`/api/v1/candidates/${second.candidate.id}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .set("x-audit-operation-id", newUuid())
      .send({ decision: "UNCERTAIN", reasonCode: "INSUFFICIENT_EVIDENCE" })
      .expect(200);
    expect(uncertain.body).toMatchObject({
      candidate: { status: "UNCERTAIN" },
      resolution: { status: "CLOSED" },
      subject: { status: "RESOLUTION_FAILED", revision: 3 },
    });
  });

  it("persists an idempotent explainable Entity match without restricted values", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const { candidate } = await addCandidate(subject, session.id);
    const entity = await createEntity(subject.workspaceId, "PERSON");
    const key = newUuid();
    const input = {
      candidateId: candidate.id,
      entityId: entity.id,
      matchLevel: "HIGH" as const,
      signals: [
        {
          kind: "MATCHING" as const,
          field: "NATIONAL_ID" as const,
          result: "EXACT_MATCH" as const,
          strength: "STRONG" as const,
          classification: "RESTRICTED" as const,
          valueVisibility: "MATCH_ONLY" as const,
        },
        {
          kind: "CONFLICT" as const,
          field: "DATE_OF_BIRTH" as const,
          result: "CONFLICT" as const,
          strength: "CONTRADICTING" as const,
          classification: "SENSITIVE" as const,
          valueVisibility: "HIDDEN" as const,
        },
      ],
      producerType: "SERVICE" as const,
      producerId: "synthetic-matcher",
    };
    const first = await asOwner(() => matches.record({ ...input, idempotencyKey: key }));
    const replay = await asOwner(() => matches.record({ ...input, idempotencyKey: key }));
    const sameSnapshot = await asOwner(() =>
      matches.record({ ...input, idempotencyKey: newUuid() }),
    );
    expect(replay).toEqual(first);
    expect(sameSnapshot.id).toBe(first.id);
    expect(first).toMatchObject({
      candidateId: candidate.id,
      entityRef: { id: entity.id, workspaceId: subject.workspaceId },
      matchLevel: "HIGH",
      policyVersion: 1,
      signals: [{ valueVisibility: "MATCH_ONLY" }],
      conflicts: [{ valueVisibility: "HIDDEN" }],
    });
    expect(JSON.stringify(first)).not.toContain("displayValue");
    expect(JSON.stringify(first)).not.toContain("fingerprint");
    expect(await repository.listEntityMatches(session.id, 10)).toEqual([first]);
    expect((await repository.findCandidate(candidate.id))?.status).toBe("PENDING_REVIEW");
    expect(
      (
        await client.db.execute(
          sql`SELECT id FROM entities WHERE workspace_id = ${subject.workspaceId}`,
        )
      ).rows,
    ).toHaveLength(1);
    const event = await client.db.execute(
      sql`SELECT payload FROM platform_outbox_events WHERE aggregate_id = ${first.id}`,
    );
    expect(event.rows).toHaveLength(1);
    expect(JSON.stringify(event.rows)).not.toContain("NATIONAL_ID");
    expect(JSON.stringify(event.rows)).not.toContain(entity.id);
  });

  it("returns governance-filtered match pages without leaking protected or cross-Case context", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const { candidate } = await addCandidate(subject, session.id);
    const entity = await createEntity(subject.workspaceId, "PERSON");
    await asOwner(() =>
      matches.record({
        candidateId: candidate.id,
        entityId: entity.id,
        matchLevel: "HIGH",
        signals: [
          {
            kind: "MATCHING",
            field: "NATIONAL_ID",
            result: "EXACT_MATCH",
            strength: "STRONG",
            classification: "RESTRICTED",
            valueVisibility: "MATCH_ONLY",
          },
          {
            kind: "MATCHING",
            field: "NAME",
            result: "PARTIAL_MATCH",
            strength: "SUPPORTING",
            classification: "INTERNAL",
            valueVisibility: "FULL",
          },
        ],
        producerType: "SERVICE",
        producerId: "synthetic-matcher",
        idempotencyKey: newUuid(),
      }),
    );

    const existenceOnly = (await get(`/resolutions/${session.id}/matches`).expect(200))
      .body;
    expect(existenceOnly).toMatchObject({
      items: [
        {
          candidateId: candidate.id,
          entityRef: { id: entity.id },
          signals: [{ field: "NAME" }],
          crossCaseContext: { exists: true, detailsVisible: false },
        },
      ],
      page: { hasMore: false, nextCursor: null },
    });
    expect(JSON.stringify(existenceOnly)).not.toContain("NATIONAL_ID");
    expect(JSON.stringify(existenceOnly)).not.toContain("classification");
    expect(JSON.stringify(existenceOnly)).not.toContain("caseId");

    const protectedGrantId = await grantPermissions(subject.workspaceId, "owner", [
      "IDENTIFIER_USE_RESTRICTED",
      "VIEW_CROSS_CASE_CONTEXT",
    ]);
    const failedOperationId = newUuid();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_match_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'SENSITIVE_FIELD_MATCH' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_match_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_match_audit();`,
      ),
    );
    try {
      await get(`/resolutions/${session.id}/matches`)
        .set("x-reason-for-access", "DUPLICATE_REVIEW")
        .set("x-audit-operation-id", failedOperationId)
        .expect(503);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_match_audit ON audit_events; DROP FUNCTION fail_match_audit();",
        ),
      );
    }
    expect(
      (
        await client.db.execute(
          sql`SELECT id FROM audit_events WHERE operation_id = ${failedOperationId}`,
        )
      ).rows,
    ).toHaveLength(0);

    const operationId = newUuid();
    const protectedView = (
      await get(`/resolutions/${session.id}/matches`)
        .set("x-reason-for-access", "DUPLICATE_REVIEW")
        .set("x-audit-operation-id", operationId)
        .expect(200)
    ).body;
    expect(protectedView.items[0]).toMatchObject({
      signals: [{ field: "NATIONAL_ID" }, { field: "NAME" }],
      crossCaseContext: { exists: true, detailsVisible: true },
    });
    const audit = await client.db.execute(sql`SELECT action, outcome, resource_type,
      resource_id, reason, classification
      FROM audit_events WHERE operation_id = ${operationId}`);
    expect(audit.rows).toEqual([
      expect.objectContaining({
        action: "SENSITIVE_FIELD_MATCH",
        outcome: "AUTHORIZED",
        resource_type: "CASE",
        resource_id: subject.caseId,
        reason: "DUPLICATE_REVIEW",
        classification: "RESTRICTED",
      }),
    ]);

    await client.db.execute(sql`UPDATE governance_role_assignments
      SET status = 'REVOKED', revision = revision + 1, revoked_at = now()
      WHERE id = ${protectedGrantId}`);
    const revokedOperationId = newUuid();
    const afterRevocation = (
      await get(`/resolutions/${session.id}/matches`)
        .set("x-reason-for-access", "DUPLICATE_REVIEW")
        .set("x-audit-operation-id", revokedOperationId)
        .expect(200)
    ).body;
    expect(afterRevocation.items[0]).toMatchObject({
      signals: [{ field: "NAME" }],
      crossCaseContext: { exists: true, detailsVisible: false },
    });
    expect(
      (
        await client.db.execute(
          sql`SELECT id FROM audit_events WHERE operation_id = ${revokedOperationId}`,
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("queries protected Identifier fingerprints without exposing values or other Cases", async () => {
    const subject = await fixture();
    const entity = await createEntity(subject.workspaceId, "PERSON");
    const rawIdentifier = "3174010101010001";
    await asOwner(() =>
      identifiers.create(
        entity.id,
        {
          type: "NATIONAL_ID",
          value: rawIdentifier,
          classification: "RESTRICTED",
        },
        newUuid(),
      ),
    );
    await grantPermissions(subject.workspaceId, "owner", ["IDENTIFIER_USE_RESTRICTED"]);
    const operationId = newUuid();
    const result = await asOwner(() =>
      identifiers.matchExact({
        workspaceId: subject.workspaceId,
        caseId: subject.caseId,
        type: "NATIONAL_ID",
        value: rawIdentifier,
        reasonForAccess: "IDENTITY_VERIFICATION",
        operationId,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        entityId: entity.id,
        workspaceId: subject.workspaceId,
        entityType: "PERSON",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(rawIdentifier);
    expect(JSON.stringify(result)).not.toContain("fingerprint");
    const durable = await client.db.execute(
      sql`SELECT id FROM audit_events WHERE operation_id = ${operationId}`,
    );
    expect(durable.rows).toHaveLength(1);
    expect(
      JSON.stringify(
        (
          await client.db.execute(sql`SELECT payload FROM platform_outbox_events
            WHERE aggregate_type = 'AUDIT_EVENT' AND aggregate_id = ${durable.rows[0]!.id}`)
        ).rows,
      ),
    ).not.toContain(rawIdentifier);

    const other = await fixture();
    await expect(
      asOwner(() =>
        identifiers.matchExact({
          workspaceId: other.workspaceId,
          caseId: subject.caseId,
          type: "NATIONAL_ID",
          value: rawIdentifier,
          reasonForAccess: "IDENTITY_VERIFICATION",
          operationId: newUuid(),
        }),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("stores RESTRICTED Candidates only with a fixed non-identifying label", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const value = await addCandidate(subject, session.id, newUuid(), {
      type: "PERSON",
      displayLabel: null,
      classification: "RESTRICTED",
      source: { origin: "INVESTIGATOR_INPUT", resource: null },
    });
    expect(value.candidate.displayLabel).toBe("Restricted candidate");
    expect(
      (await get(`/candidates/${value.candidate.id}`).expect(200)).body,
    ).toMatchObject({
      classification: "RESTRICTED",
      displayLabel: "Restricted candidate",
    });
    await expect(
      client.db.execute(sql`UPDATE candidates SET display_label = 'Raw restricted value'
        WHERE id = ${value.candidate.id}`),
    ).rejects.toThrow();
    await expect(
      client.db.execute(sql`INSERT INTO candidates
        (id, resolution_session_id, subject_id, workspace_id, case_id, candidate_type,
         status, display_label, classification, source_origin, source_resource_type,
         source_resource_id, revision, created_at, updated_at)
        VALUES (${newUuid()}, ${session.id}, ${subject.id}, ${subject.workspaceId},
          ${subject.caseId}, 'PERSON', 'PENDING_REVIEW', 'Raw restricted value',
          'RESTRICTED', 'INVESTIGATOR_INPUT', NULL, NULL, 1, now(), now())`),
    ).rejects.toThrow();
  });

  it("rejects incompatible match targets and rolls back match state on Outbox failure", async () => {
    const subject = await fixture();
    const session = await createSession(subject);
    const { candidate } = await addCandidate(subject, session.id);
    const incompatible = await createEntity(subject.workspaceId, "DOMAIN");
    const valid = await createEntity(subject.workspaceId, "PERSON");
    const signal = {
      kind: "MATCHING" as const,
      field: "NAME" as const,
      result: "PARTIAL_MATCH" as const,
      strength: "SUPPORTING" as const,
      classification: "INTERNAL" as const,
      valueVisibility: "FULL" as const,
    };
    await expect(
      asOwner(() =>
        matches.record({
          candidateId: candidate.id,
          entityId: incompatible.id,
          matchLevel: "LOW",
          signals: [signal],
          producerType: "SERVICE",
          producerId: "synthetic-matcher",
          idempotencyKey: newUuid(),
        }),
      ),
    ).rejects.toMatchObject({ code: "ENTITY_MATCH_TARGET_INVALID" });

    const key = newUuid();
    await client.db.execute(
      sql.raw(
        `CREATE FUNCTION fail_entity_match_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'ENTITY_MATCH_RECORDED' THEN RAISE EXCEPTION 'synthetic-private-failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_entity_match_event BEFORE INSERT ON platform_outbox_events FOR EACH ROW EXECUTE FUNCTION fail_entity_match_event();`,
      ),
    );
    const record = () =>
      asOwner(() =>
        matches.record({
          candidateId: candidate.id,
          entityId: valid.id,
          matchLevel: "MEDIUM",
          signals: [signal],
          producerType: "SERVICE",
          producerId: "synthetic-matcher",
          idempotencyKey: key,
        }),
      );
    try {
      await expect(record()).rejects.toThrow();
      expect(
        (
          await client.db.execute(
            sql`SELECT id FROM resolution_entity_matches WHERE candidate_id = ${candidate.id}`,
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await client.db.execute(
            sql`SELECT entity_match_id FROM resolution_entity_match_idempotency
              WHERE idempotency_key = ${key}`,
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.db.execute(
        sql.raw(
          "DROP TRIGGER fail_entity_match_event ON platform_outbox_events; DROP FUNCTION fail_entity_match_event();",
        ),
      );
    }
    const persisted = await record();
    await expect(
      client.db.execute(
        sql`UPDATE resolution_entity_matches SET match_level = 'HIGH'
          WHERE id = ${persisted.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      client.db.execute(
        sql`DELETE FROM resolution_match_signals WHERE entity_match_id = ${persisted.id}`,
      ),
    ).rejects.toThrow();
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
    await get(`/resolutions/${session.id}/matches`, "viewer").expect(403);
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

    const { candidate } = await addCandidate(subject, session.id);
    for (let index = 0; index < 2; index += 1) {
      const entity = await createEntity(subject.workspaceId, "PERSON");
      await asOwner(() =>
        matches.record({
          candidateId: candidate.id,
          entityId: entity.id,
          matchLevel: "LOW",
          signals: [
            {
              kind: "MATCHING",
              field: "NAME",
              result: "PARTIAL_MATCH",
              strength: "WEAK",
              classification: "INTERNAL",
              valueVisibility: "FULL",
            },
          ],
          producerType: "SERVICE",
          producerId: "synthetic-matcher",
          idempotencyKey: newUuid(),
        }),
      );
    }
    const matchPage = (
      await get(`/resolutions/${session.id}/matches?limit=1`).expect(200)
    ).body;
    expect(matchPage).toMatchObject({ page: { hasMore: true } });
    const nextMatchPage = (
      await get(
        `/resolutions/${session.id}/matches?limit=1&cursor=${matchPage.page.nextCursor}`,
      ).expect(200)
    ).body;
    expect(nextMatchPage.items[0].id).not.toBe(matchPage.items[0].id);
    await get(
      `/resolutions/${other.id}/matches?cursor=${matchPage.page.nextCursor}`,
    ).expect(400);
    await get(`/resolutions/${session.id}/matches?limit=101`).expect(400);
    await get(`/resolutions/${session.id}/matches?candidateId=${candidate.id}`).expect(
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
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/candidates/${newUuid()}/actions/resolve`)
      .set("authorization", "Bearer owner")
      .set("if-match", '"1"')
      .set("idempotency-key", newUuid())
      .set("x-audit-operation-id", newUuid())
      .send({ decision: "CREATE_NEW", reasonCode: "MANUAL_REVIEW" })
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
       reason_code, decided_by_user_id, decided_at, workspace_id)
      VALUES (${decisionId}, ${session.id}, ${value.candidate.id}, 'REJECT', NULL,
        'NOT_SAME_IDENTITY', 'owner', now(), ${subject.workspaceId})`);
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
    await grantWorkspaceManage(workspace.id);
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
      transactions.run(
        async () =>
          (
            await repository.createSession({
              workspaceId: subject.workspaceId,
              caseId: subject.caseId,
              subjectId: subject.id,
              actorUserId: "owner",
              idempotencyKey: key,
              requestHash: createHash("sha256")
                .update(`${subject.workspaceId}:${subject.caseId}:${subject.id}`)
                .digest("hex"),
            })
          ).session,
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

  function createEntity(workspaceId: string, type: "PERSON" | "DOMAIN") {
    return asOwner(() =>
      entities.create(
        workspaceId,
        { type, canonicalLabel: `Synthetic ${type} ${newUuid()}` },
        newUuid(),
      ),
    );
  }

  async function grantWorkspaceManage(workspaceId: string) {
    await grantPermissions(workspaceId, "owner", [
      "WORKSPACE_VIEW",
      "WORKSPACE_MANAGE",
      "DISCOVER_ENTITY_EXISTENCE",
    ]);
  }

  async function grantPermissions(
    workspaceId: string,
    userId: string,
    permissions: readonly Permission[],
  ) {
    const roleId = newUuid();
    const roleKey = `P2_007_${newUuid().replaceAll("-", "_").toUpperCase()}`;
    await client.db.execute(sql`INSERT INTO governance_roles
      (id, workspace_id, key, name, status, revision, created_at, updated_at)
      VALUES (${roleId}, ${workspaceId}, ${roleKey},
        'Resolution synthetic role', 'ACTIVE', 1, now(), now())`);
    for (const permission of permissions)
      await client.db.execute(sql`INSERT INTO governance_role_permissions
        (role_id, permission) VALUES (${roleId}, ${permission})`);
    const assignmentId = newUuid();
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
