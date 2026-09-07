export { ResolutionModule } from "./resolution.module.js";
export { ResolutionFacade } from "./application/resolution.facade.js";
export { ResolutionMatchFacade } from "./application/resolution-match.facade.js";
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
  MATCH_LEVELS,
  MATCH_SIGNAL_FIELDS,
  MATCH_SIGNAL_KINDS,
  MATCH_SIGNAL_RESULTS,
  MATCH_SIGNAL_STRENGTHS,
  createEntityMatch,
  presentEntityMatch,
  type ConflictSignal,
  type CreateEntityMatchInput,
  type CreateMatchSignalInput,
  type EntityMatch,
  type MatchingSignal,
  type MatchLevel,
  type MatchSignalField,
  type MatchSignalKind,
  type MatchSignalResult,
  type MatchSignalStrength,
} from "./domain/matching-signal.js";
export {
  RESOLUTION_SESSION_STATUSES,
  type ResolutionSession,
  type ResolutionSessionStatus,
} from "./domain/resolution-session.js";
