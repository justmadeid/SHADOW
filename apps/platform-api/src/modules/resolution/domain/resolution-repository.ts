import type {
  Candidate,
  CandidateType,
  CreateCandidateInput,
  ResolutionDecision,
  ResolutionDecisionType,
  ResolutionReasonCode,
} from "./candidate.js";
import type {
  CreateMatchSignalInput,
  EntityMatch,
  MatchLevel,
} from "./matching-signal.js";
import type { ResolutionSession } from "./resolution-session.js";

export const RESOLUTION_REPOSITORY = Symbol("RESOLUTION_REPOSITORY");

export type CandidateDecisionPreparation =
  | {
      replayed: true;
      session: ResolutionSession;
      candidate: Candidate;
      decision: ResolutionDecision;
    }
  | {
      replayed: false;
      session: ResolutionSession;
      candidate: Candidate;
      remainingPendingCandidates: number;
    };

export interface ResolutionRepository {
  createSession(command: {
    workspaceId: string;
    caseId: string;
    subjectId: string;
    actorUserId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ session: ResolutionSession; replayed: boolean }>;
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
  findLatestSessionForSubject(subjectId: string): Promise<ResolutionSession | undefined>;
  findCandidate(id: string): Promise<Candidate | undefined>;
  listCandidates(
    resolutionSessionId: string,
    limit: number,
    before?: string,
  ): Promise<Candidate[]>;
  prepareCandidateDecision(command: {
    candidateId: string;
    actorUserId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<CandidateDecisionPreparation>;
  commitCandidateDecision(command: {
    session: ResolutionSession;
    candidate: Candidate;
    remainingPendingCandidates: number;
    decision: ResolutionDecisionType;
    targetEntityId?: string | null;
    reasonCode: ResolutionReasonCode;
    actorUserId: string;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{
    session: ResolutionSession;
    candidate: Candidate;
    decision: ResolutionDecision;
  }>;
  recordEntityMatch(command: {
    candidate: Candidate;
    entity: {
      id: string;
      workspaceId: string;
      type: CandidateType;
      revision: number;
    };
    matchLevel: MatchLevel;
    signals: readonly CreateMatchSignalInput[];
    producerType: "USER" | "SERVICE";
    producerId: string;
    idempotencyKey: string;
  }): Promise<EntityMatch>;
  findEntityMatch(id: string): Promise<EntityMatch | undefined>;
  listEntityMatches(
    resolutionSessionId: string,
    limit: number,
    before?: string,
    includeProtected?: boolean,
  ): Promise<EntityMatch[]>;
}
