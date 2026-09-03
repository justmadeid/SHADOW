import type { CreateWorkspaceInput, Workspace } from "./workspace.js";

export type CreateWorkspaceCommand = CreateWorkspaceInput & {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
};

export type CreateWorkspaceResult = {
  workspace: Workspace;
  replayed: boolean;
};

export interface WorkspaceRepository {
  createForUser(command: CreateWorkspaceCommand): Promise<CreateWorkspaceResult>;
  listForUser(userId: string, limit: number): Promise<Workspace[]>;
  findByIdForUser(workspaceId: string, userId: string): Promise<Workspace | undefined>;
}
