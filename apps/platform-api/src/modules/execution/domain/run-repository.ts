import type { Run, RunInputSnapshot, RunTrigger } from "./run.js";

export const RUN_REPOSITORY = Symbol("RUN_REPOSITORY");

export type CreateRunCommand = {
  workspaceId: string;
  caseId: string;
  investigationId: string;
  nodeInstanceId: string;
  nodeDefinitionKey: string;
  nodeDefinitionVersion: number;
  inputSnapshot: RunInputSnapshot;
  trigger: RunTrigger;
  triggeredByUserId: string;
  retryOf?: string | null;
  idempotencyKey: string;
  requestHash: string;
};

export type CreateRunResult = { run: Run; replayed: boolean };

export type CancelRunCommand = {
  runId: string;
  expectedRevision: number;
  actorUserId: string;
};

export interface RunRepository {
  create(command: CreateRunCommand): Promise<CreateRunResult>;
  find(id: string): Promise<Run | undefined>;
  listByCase(
    workspaceId: string,
    caseId: string,
    limit: number,
    before?: string,
  ): Promise<Run[]>;
  cancel(command: CancelRunCommand): Promise<Run>;
}
