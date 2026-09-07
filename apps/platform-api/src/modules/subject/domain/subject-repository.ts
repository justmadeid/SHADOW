import type {
  InvestigationSubject,
  SubjectRole,
  SubjectType,
} from "./investigation-subject.js";
import type { SubjectSeed, SubjectSeedFieldInput } from "./subject-seed.js";

export type CreateSubjectInput = {
  subjectType: SubjectType;
  role: SubjectRole;
  investigationId?: string | null;
  seed?: { fields: SubjectSeedFieldInput[] };
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
  findSeed(subjectId: string): Promise<SubjectSeed | undefined>;
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
