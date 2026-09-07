import type { Candidate, CandidateType, CreateCandidateInput } from "./candidate.js";
import type { ResolutionSession } from "./resolution-session.js";

export const RESOLUTION_REPOSITORY = Symbol("RESOLUTION_REPOSITORY");

export interface ResolutionRepository {
  createSession(command: {
    workspaceId: string;
    caseId: string;
    subjectId: string;
    actorUserId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<ResolutionSession>;
  addCandidate(
    command: CreateCandidateInput & {
      resolutionSessionId: string;
      subjectId: string;
      subjectType: CandidateType | "UNKNOWN";
      workspaceId: string;
      caseId: string;
      producerType: "USER" | "SERVICE";
      producerId: string;
      idempotencyKey: string;
    },
  ): Promise<{ session: ResolutionSession; candidate: Candidate }>;
  findSession(id: string): Promise<ResolutionSession | undefined>;
  findCandidate(id: string): Promise<Candidate | undefined>;
  listCandidates(
    resolutionSessionId: string,
    limit: number,
    before?: string,
  ): Promise<Candidate[]>;
}
