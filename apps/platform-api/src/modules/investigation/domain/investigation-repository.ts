import type {
  CreateInvestigationInput,
  Investigation,
  UpdateInvestigationInput,
} from "./investigation.js";

export type CreateInvestigationCommand = CreateInvestigationInput & {
  workspaceId: string;
  caseId: string;
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
};

export type CreateInvestigationResult = {
  investigation: Investigation;
  replayed: boolean;
};

export type UpdateInvestigationCommand = {
  investigationId: string;
  workspaceId: string;
  caseId: string;
  expectedRevision: number;
  changes: UpdateInvestigationInput;
};

export interface InvestigationRepository {
  create(command: CreateInvestigationCommand): Promise<CreateInvestigationResult>;
  listByCase(
    workspaceId: string,
    caseId: string,
    limit: number,
  ): Promise<Investigation[]>;
  findById(investigationId: string): Promise<Investigation | undefined>;
  update(command: UpdateInvestigationCommand): Promise<Investigation>;
}
