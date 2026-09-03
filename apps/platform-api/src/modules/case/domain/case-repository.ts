import type { Case, CaseStatus, CreateCaseInput, UpdateCaseInput } from "./case.js";

export type CreateCaseCommand = CreateCaseInput & {
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
};

export type CreateCaseResult = {
  case: Case;
  replayed: boolean;
};

export type UpdateCaseCommand = {
  caseId: string;
  expectedRevision: number;
  actorUserId: string;
  changes: UpdateCaseInput;
};

export type TransitionCaseCommand = {
  caseId: string;
  expectedRevision: number;
  actorUserId: string;
  fromStatus: CaseStatus;
  toStatus: CaseStatus;
};

export interface CaseRepository {
  create(command: CreateCaseCommand): Promise<CreateCaseResult>;
  listByWorkspace(workspaceId: string, limit: number): Promise<Case[]>;
  findById(caseId: string): Promise<Case | undefined>;
  update(command: UpdateCaseCommand): Promise<Case>;
  transition(command: TransitionCaseCommand): Promise<Case>;
}
