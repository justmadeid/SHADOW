export { ResolutionModule } from "./resolution.module.js";
export { ResolutionFacade } from "./application/resolution.facade.js";
export {
  CANDIDATE_SOURCE_ORIGINS,
  CANDIDATE_STATUSES,
  CANDIDATE_TYPES,
  RESOLUTION_DECISIONS,
  RESOLUTION_REASON_CODES,
  type Candidate,
  type CandidateSource,
  type CandidateSourceOrigin,
  type CandidateStatus,
  type CandidateType,
  type ResolutionDecision,
  type ResolutionDecisionType,
  type ResolutionReasonCode,
} from "./domain/candidate.js";
export {
  RESOLUTION_SESSION_STATUSES,
  type ResolutionSession,
  type ResolutionSessionStatus,
} from "./domain/resolution-session.js";
