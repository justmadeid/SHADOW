import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { CaseFacade, type Case } from "../../case/index.js";
import { InvestigationFacade } from "../../investigation/index.js";
import { AppError } from "../../../platform/errors/index.js";
import { RequestContextStore } from "../../../platform/request-context/index.js";
import { assertExpectedRevision } from "../../../platform/http/etag.js";
import { parseIdempotencyKey } from "../../../platform/http/idempotency.js";
import { decodeCursor, encodeCursor } from "../../../platform/http/cursor.js";
import { isResourceId } from "@intelligence/contracts";
import {
  SUBJECT_REPOSITORY,
  type SubjectRepository,
  type CreateSubjectInput,
  type UpdateSubjectInput,
} from "../domain/subject-repository.js";
import { parseCreateSubject, parseUpdateSubject } from "../domain/subject-input.js";
import { validateSubjectSeed } from "../domain/subject-seed.js";

@Injectable()
export class SubjectFacade {
  constructor(
    @Inject(SUBJECT_REPOSITORY) private readonly repository: SubjectRepository,
    @Inject(CaseFacade) private readonly cases: CaseFacade,
    @Inject(InvestigationFacade) private readonly investigations: InvestigationFacade,
    @Inject(RequestContextStore) private readonly context: RequestContextStore,
  ) {}

  async create(caseId: string, input: CreateSubjectInput, idempotencyKey: string) {
    const actorUserId = this.requireUser();
    const normalized = parseCreateSubject(input);
    parseIdempotencyKey(idempotencyKey, { required: true });
    return this.cases.withAccess(caseId, "SUBJECT_CREATE", async (parent) => {
      this.mutableParent(parent);
      const seed = normalized.seed
        ? {
            fields: validateSubjectSeed(normalized.seed.fields, {
              workspaceId: parent.workspaceId,
              caseId,
              subjectType: normalized.subjectType,
            }),
          }
        : undefined;
      if (normalized.investigationId) {
        const investigation = await this.investigations.get(normalized.investigationId);
        if (
          investigation.caseId !== parent.id ||
          investigation.workspaceId !== parent.workspaceId
        )
          return this.notFound();
        if (investigation.status !== "ACTIVE")
          throw new AppError({
            code: "SUBJECT_INVESTIGATION_NOT_ACTIVE",
            message: "Subject creation requires an active Investigation.",
            statusCode: 409,
          });
      }
      const requestHash = createHash("sha256")
        // Seed values are deliberately excluded: a plain digest would create a
        // guessable-value fingerprint. The repository compares replay fields.
        .update(
          JSON.stringify({
            caseId,
            subjectType: normalized.subjectType,
            role: normalized.role,
            investigationId: normalized.investigationId,
            hasSeed: Boolean(seed),
          }),
        )
        .digest("hex");
      return this.repository.create({
        ...normalized,
        caseId,
        workspaceId: parent.workspaceId,
        actorUserId,
        idempotencyKey,
        requestHash,
        ...(seed ? { seed } : {}),
      });
    });
  }

  async getSeed(subjectId: string) {
    const subject = await this.get(subjectId);
    const seed = await this.repository.findSeed(subject.id);
    if (
      !seed ||
      seed.workspaceId !== subject.workspaceId ||
      seed.caseId !== subject.caseId
    )
      return this.seedNotFound();
    return seed;
  }

  async get(id: string) {
    this.requireUser();
    const found = await this.repository.find(id);
    if (!found) return this.notFound();
    try {
      const parent = await this.cases.get(found.caseId, "SUBJECT_VIEW");
      if (parent.workspaceId !== found.workspaceId) return this.notFound();
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return this.notFound();
      throw error;
    }
    return found;
  }

  async list(caseId: string, limit = 50, cursor?: string) {
    this.requireUser();
    const parent = await this.cases.get(caseId, "SUBJECT_VIEW");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AppError({
        code: "VALIDATION_INVALID_LIMIT",
        message: "Limit must be between 1 and 100.",
        statusCode: 400,
      });
    let before: string | undefined;
    if (cursor !== undefined) {
      const value = decodeCursor<unknown>(cursor);
      if (
        !value ||
        typeof value !== "object" ||
        !("caseId" in value) ||
        value.caseId !== caseId ||
        !("workspaceId" in value) ||
        value.workspaceId !== parent.workspaceId ||
        !("before" in value) ||
        typeof value.before !== "string" ||
        !isResourceId(value.before)
      )
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "Subject cursor is invalid.",
          statusCode: 400,
        });
      before = value.before;
    }
    const rows = await this.repository.list(
      parent.workspaceId,
      caseId,
      limit + 1,
      before,
    );
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items,
      page: {
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({
              caseId,
              workspaceId: parent.workspaceId,
              before: items.at(-1)!.id,
            })
          : null,
      },
    };
  }

  async update(id: string, input: UpdateSubjectInput, expectedRevision: number) {
    const actorUserId = this.requireUser();
    const found = await this.get(id);
    const changes = parseUpdateSubject(input);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new AppError({
        code: "VALIDATION_IF_MATCH_REQUIRED",
        message: "A positive Subject revision is required.",
        statusCode: 400,
      });
    return this.cases.withAccess(found.caseId, "SUBJECT_UPDATE", async (parent) => {
      this.mutableParent(parent);
      const current = await this.get(id);
      assertExpectedRevision(expectedRevision, current.revision);
      return this.repository.update(current, changes, actorUserId);
    });
  }
  private mutableParent(parent: Case) {
    if (parent.status === "CLOSED" || parent.status === "ARCHIVED")
      throw new AppError({
        code: "SUBJECT_PARENT_CASE_NOT_MUTABLE",
        message: "Subjects cannot be changed in a closed or archived Case.",
        statusCode: 409,
      });
  }
  private requireUser() {
    const principal = this.context.get().principal;
    if (!principal || principal.kind !== "USER")
      throw new AppError({
        code: "AUTH_USER_REQUIRED",
        message: "This operation requires an authenticated user.",
        statusCode: 403,
      });
    return principal.userId;
  }
  private notFound(): never {
    throw new AppError({
      code: "SUBJECT_NOT_FOUND",
      message: "Subject was not found.",
      statusCode: 404,
    });
  }

  private seedNotFound(): never {
    throw new AppError({
      code: "SUBJECT_SEED_NOT_FOUND",
      message: "Subject seed was not found.",
      statusCode: 404,
    });
  }
}
