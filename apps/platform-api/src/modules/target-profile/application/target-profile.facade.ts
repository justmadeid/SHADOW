import { Inject, Injectable } from "@nestjs/common";
import { AppError } from "../../../platform/errors/index.js";
import { EntityFacade, IdentifierFacade } from "../../entity/index.js";
import { SubjectFacade } from "../../subject/index.js";
import { composeTargetProfileView } from "../domain/target-profile-view.js";

@Injectable()
export class TargetProfileFacade {
  constructor(
    @Inject(SubjectFacade) private readonly subjects: SubjectFacade,
    @Inject(EntityFacade) private readonly entities: EntityFacade,
    @Inject(IdentifierFacade) private readonly identifiers: IdentifierFacade,
  ) {}

  async get(caseId: string, subjectId: string) {
    const subject = await this.loadSubject(subjectId);
    if (subject.caseId !== caseId) return this.notFound();

    let entity = null;
    let identifiers: Awaited<ReturnType<IdentifierFacade["list"]>>["items"] = [];
    if (subject.entityRef) {
      entity = await this.entities.getForTargetProfile(
        subject.workspaceId,
        subject.entityRef.id,
      );
      if (!entity) return this.notFound();
      identifiers = (
        await this.identifiers.listForTargetProfile(entity.id, entity.workspaceId)
      ).items;
    }

    return composeTargetProfileView({
      subject:
        subject.entityRef && entity
          ? {
              ...subject,
              entityRef: {
                type: "ENTITY",
                id: entity.id,
                workspaceId: entity.workspaceId,
              },
            }
          : subject,
      entity,
      identifiers,
      generatedAt: new Date(),
    });
  }

  private async loadSubject(subjectId: string) {
    try {
      return await this.subjects.get(subjectId);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return this.notFound();
      throw error;
    }
  }

  private notFound(): never {
    throw new AppError({
      code: "TARGET_PROFILE_NOT_FOUND",
      message: "Target Profile was not found.",
      statusCode: 404,
    });
  }
}
