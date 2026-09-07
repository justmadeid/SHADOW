import type {
  InvestigationSubject,
  SubjectRole,
  SubjectType,
} from "./investigation-subject.js";

export type CreateSubjectInput = {
  subjectType: SubjectType;
  role: SubjectRole;
  investigationId?: string | null;
};
export type UpdateSubjectInput = { role?: SubjectRole; status?: "ARCHIVED" };
export const SUBJECT_REPOSITORY = Symbol("SUBJECT_REPOSITORY");

export interface SubjectRepository {
  create(
    command: CreateSubjectInput & {
      workspaceId: string;
      caseId: string;
      actorUserId: string;
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<InvestigationSubject>;
  find(id: string): Promise<InvestigationSubject | undefined>;
  list(
    workspaceId: string,
    caseId: string,
    limit: number,
    before?: string,
  ): Promise<InvestigationSubject[]>;
  update(
    current: InvestigationSubject,
    input: UpdateSubjectInput,
    actorUserId: string,
  ): Promise<InvestigationSubject>;
}
