import { Inject, Injectable } from "@nestjs/common";
import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/http/cursor.js";
import { SubjectFacade } from "../../subject/index.js";
import {
  RESOLUTION_REPOSITORY,
  type ResolutionRepository,
} from "../domain/resolution-repository.js";
import type { ResolutionSession } from "../domain/resolution-session.js";

@Injectable()
export class ResolutionFacade {
  constructor(
    @Inject(RESOLUTION_REPOSITORY)
    private readonly repository: ResolutionRepository,
    @Inject(SubjectFacade) private readonly subjects: SubjectFacade,
  ) {}

  async getSession(id: string): Promise<ResolutionSession> {
    const found = await this.repository.findSession(id);
    if (!found) return this.resolutionNotFound();
    await this.authorizeSubject(found.subjectId, "RESOLUTION_NOT_FOUND");
    return found;
  }

  async listCandidates(resolutionId: string, limit = 50, cursor?: string) {
    const session = await this.getSession(resolutionId);
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
        !("resolutionId" in value) ||
        value.resolutionId !== resolutionId ||
        !("workspaceId" in value) ||
        value.workspaceId !== session.workspaceId ||
        !("caseId" in value) ||
        value.caseId !== session.caseId ||
        !("before" in value) ||
        typeof value.before !== "string" ||
        !isResourceId(value.before)
      )
        throw new AppError({
          code: "VALIDATION_INVALID_CURSOR",
          message: "Candidate cursor is invalid.",
          statusCode: 400,
        });
      before = value.before;
    }
    const rows = await this.repository.listCandidates(resolutionId, limit + 1, before);
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items,
      page: {
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({
              resolutionId,
              workspaceId: session.workspaceId,
              caseId: session.caseId,
              before: items.at(-1)!.id,
            })
          : null,
      },
    };
  }

  async getCandidate(id: string) {
    const found = await this.repository.findCandidate(id);
    if (!found) return this.candidateNotFound();
    const session = await this.repository.findSession(found.resolutionSessionId);
    if (
      !session ||
      session.subjectId !== found.subjectId ||
      session.workspaceId !== found.workspaceId ||
      session.caseId !== found.caseId
    )
      return this.candidateNotFound();
    await this.authorizeSubject(found.subjectId, "CANDIDATE_NOT_FOUND");
    return found;
  }

  private async authorizeSubject(
    subjectId: string,
    notFoundCode: "RESOLUTION_NOT_FOUND" | "CANDIDATE_NOT_FOUND",
  ): Promise<void> {
    try {
      await this.subjects.get(subjectId);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) {
        if (notFoundCode === "CANDIDATE_NOT_FOUND") return this.candidateNotFound();
        return this.resolutionNotFound();
      }
      throw error;
    }
  }

  private resolutionNotFound(): never {
    throw new AppError({
      code: "RESOLUTION_NOT_FOUND",
      message: "Resolution session was not found.",
      statusCode: 404,
    });
  }

  private candidateNotFound(): never {
    throw new AppError({
      code: "CANDIDATE_NOT_FOUND",
      message: "Candidate was not found.",
      statusCode: 404,
    });
  }
}
