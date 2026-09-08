import {
  DATA_CLASSIFICATIONS,
  FIELD_VISIBILITIES,
  isResourceId,
  type DataClassification,
  type FieldVisibility,
} from "@intelligence/contracts";
import type { EntityRef, EntityType } from "../../entity/index.js";
import { AppError } from "../../../platform/errors/index.js";
import type { Candidate } from "./candidate.js";

export const MATCH_LEVELS = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;
export const MATCH_SIGNAL_KINDS = ["MATCHING", "CONFLICT"] as const;
export const MATCH_SIGNAL_FIELDS = [
  "NATIONAL_ID",
  "PHONE",
  "EMAIL",
  "PLATFORM_USER_ID",
  "USERNAME",
  "INTERNAL_RESIDENT_ID",
  "NAME",
  "DATE_OF_BIRTH",
  "DOMAIN",
  "ACCOUNT_HANDLE",
] as const;
export const MATCH_SIGNAL_RESULTS = [
  "EXACT_MATCH",
  "PARTIAL_MATCH",
  "NO_MATCH",
  "CONFLICT",
] as const;
export const MATCH_SIGNAL_STRENGTHS = [
  "WEAK",
  "SUPPORTING",
  "STRONG",
  "CONTRADICTING",
] as const;

export type MatchLevel = (typeof MATCH_LEVELS)[number];
export type MatchSignalKind = (typeof MATCH_SIGNAL_KINDS)[number];
export type MatchSignalField = (typeof MATCH_SIGNAL_FIELDS)[number];
export type MatchSignalResult = (typeof MATCH_SIGNAL_RESULTS)[number];
export type MatchSignalStrength = (typeof MATCH_SIGNAL_STRENGTHS)[number];

export type CreateMatchSignalInput = Readonly<{
  kind: MatchSignalKind;
  field: MatchSignalField;
  result: MatchSignalResult;
  strength: MatchSignalStrength;
  classification: DataClassification;
  valueVisibility: FieldVisibility;
}>;

/**
 * Explainable comparison metadata only. It deliberately has no raw value,
 * masked value, comparison fingerprint, score, or free-text rationale.
 */
export type MatchingSignal = Readonly<
  CreateMatchSignalInput & {
    id: string;
    entityMatchId: string;
    createdAt: string;
  }
>;

export type ConflictSignal = MatchingSignal & Readonly<{ kind: "CONFLICT" }>;

export type EntityMatch = Readonly<{
  id: string;
  resolutionSessionId: string;
  candidateId: string;
  candidateRevision: number;
  workspaceId: string;
  caseId: string;
  entityRef: EntityRef;
  entityRevision: number;
  matchLevel: MatchLevel;
  policyVersion: 1;
  signals: readonly MatchingSignal[];
  conflicts: readonly ConflictSignal[];
  createdAt: string;
}>;

export type MatchSignalView = Readonly<{
  field: MatchSignalField;
  result: MatchSignalResult;
  strength: MatchSignalStrength;
  valueVisibility: FieldVisibility;
}>;

export type EntityMatchView = Readonly<{
  id: string;
  candidateId: string;
  entityRef: EntityRef;
  matchLevel: MatchLevel;
  signals: readonly MatchSignalView[];
  conflicts: readonly MatchSignalView[];
  crossCaseContext: Readonly<{ exists: true; detailsVisible: boolean }>;
  createdAt: string;
}>;

export type CreateEntityMatchInput = Readonly<{
  id: string;
  candidate: Candidate;
  entity: {
    id: string;
    workspaceId: string;
    type: EntityType;
    revision: number;
  };
  matchLevel: MatchLevel;
  signals: readonly (CreateMatchSignalInput & { id: string })[];
}>;

export function createEntityMatch(input: CreateEntityMatchInput, now: Date): EntityMatch {
  for (const id of [input.id, input.candidate.id, input.entity.id]) validateId(id);
  if (
    input.candidate.status !== "PENDING_REVIEW" ||
    input.entity.workspaceId !== input.candidate.workspaceId ||
    input.entity.type !== input.candidate.type ||
    !Number.isSafeInteger(input.candidate.revision) ||
    input.candidate.revision < 1 ||
    !Number.isSafeInteger(input.entity.revision) ||
    input.entity.revision < 1 ||
    !MATCH_LEVELS.includes(input.matchLevel) ||
    !Array.isArray(input.signals) ||
    input.signals.length < 1 ||
    input.signals.length > 50
  )
    invalid();

  const createdAt = instant(now);
  const seen = new Set<string>();
  const allSignals = input.signals.map((signal) => {
    validateId(signal.id);
    if (seen.has(signal.id)) invalid();
    seen.add(signal.id);
    return createSignal(input.id, signal, createdAt);
  });
  const signals = allSignals.filter(
    (signal): signal is MatchingSignal => signal.kind === "MATCHING",
  );
  const conflicts = allSignals.filter(
    (signal): signal is ConflictSignal => signal.kind === "CONFLICT",
  );
  if (signals.length === 0 && conflicts.length === 0) invalid();
  const strongest = signals.reduce(
    (current, signal) =>
      Math.max(
        current,
        { WEAK: 1, SUPPORTING: 2, STRONG: 3 }[
          signal.strength as Exclude<MatchSignalStrength, "CONTRADICTING">
        ],
      ),
    0,
  );
  if (
    (input.matchLevel === "MEDIUM" && strongest < 2) ||
    (["HIGH", "VERY_HIGH"].includes(input.matchLevel) && strongest < 3) ||
    (signals.length === 0 && input.matchLevel !== "LOW")
  )
    invalid();

  return Object.freeze({
    id: input.id,
    resolutionSessionId: input.candidate.resolutionSessionId,
    candidateId: input.candidate.id,
    candidateRevision: input.candidate.revision,
    workspaceId: input.candidate.workspaceId,
    caseId: input.candidate.caseId,
    entityRef: Object.freeze({
      type: "ENTITY",
      id: input.entity.id,
      workspaceId: input.entity.workspaceId,
    }),
    entityRevision: input.entity.revision,
    matchLevel: input.matchLevel,
    policyVersion: 1,
    signals: Object.freeze(signals),
    conflicts: Object.freeze(conflicts),
    createdAt,
  });
}

/** P2-007 supplies the contextual existence decision before this view is returned. */
export function presentEntityMatch(
  value: EntityMatch,
  canDiscoverEntity: boolean,
): EntityMatch | null {
  if (!canDiscoverEntity) return null;
  const signals = value.signals.filter((signal) => signal.valueVisibility !== "HIDDEN");
  const conflicts = value.conflicts.filter(
    (signal) => signal.valueVisibility !== "HIDDEN",
  );
  if (signals.length === 0 && conflicts.length === 0) return null;
  return Object.freeze({
    ...value,
    entityRef: Object.freeze({ ...value.entityRef }),
    signals: Object.freeze(signals),
    conflicts: Object.freeze(conflicts),
  });
}

/** Public P2-007 projection; protected signal use is a distinct permission. */
export function presentEntityMatchView(
  value: EntityMatch,
  access: {
    canDiscoverEntity: boolean;
    canUseProtectedSignals: boolean;
    canViewCrossCaseContext: boolean;
  },
): EntityMatchView | null {
  if (!access.canDiscoverEntity) return null;
  const visible = (signal: MatchingSignal) =>
    signal.valueVisibility !== "HIDDEN" &&
    (access.canUseProtectedSignals ||
      !["SENSITIVE", "RESTRICTED"].includes(signal.classification));
  const signals = value.signals.filter(visible).map(signalView);
  const conflicts = value.conflicts.filter(visible).map(signalView);
  if (signals.length === 0 && conflicts.length === 0) return null;
  return Object.freeze({
    id: value.id,
    candidateId: value.candidateId,
    entityRef: Object.freeze({ ...value.entityRef }),
    matchLevel: value.matchLevel,
    signals: Object.freeze(signals),
    conflicts: Object.freeze(conflicts),
    crossCaseContext: Object.freeze({
      exists: true as const,
      detailsVisible: access.canViewCrossCaseContext,
    }),
    createdAt: value.createdAt,
  });
}

function createSignal(
  entityMatchId: string,
  input: CreateMatchSignalInput & { id: string },
  createdAt: string,
): MatchingSignal {
  if (
    !MATCH_SIGNAL_KINDS.includes(input.kind) ||
    !MATCH_SIGNAL_FIELDS.includes(input.field) ||
    !MATCH_SIGNAL_RESULTS.includes(input.result) ||
    !MATCH_SIGNAL_STRENGTHS.includes(input.strength) ||
    !DATA_CLASSIFICATIONS.includes(input.classification) ||
    !FIELD_VISIBILITIES.includes(input.valueVisibility)
  )
    invalid();

  const matching = input.kind === "MATCHING";
  if (
    matching !== ["EXACT_MATCH", "PARTIAL_MATCH"].includes(input.result) ||
    matching !== ["WEAK", "SUPPORTING", "STRONG"].includes(input.strength)
  )
    invalid();
  if (
    (input.classification === "SENSITIVE" || input.classification === "RESTRICTED") &&
    !["MATCH_ONLY", "HIDDEN"].includes(input.valueVisibility)
  )
    invalid();

  return Object.freeze({
    id: input.id,
    entityMatchId,
    kind: input.kind,
    field: input.field,
    result: input.result,
    strength: input.strength,
    classification: input.classification,
    valueVisibility: input.valueVisibility,
    createdAt,
  });
}

function signalView(value: MatchingSignal): MatchSignalView {
  return Object.freeze({
    field: value.field,
    result: value.result,
    strength: value.strength,
    valueVisibility: value.valueVisibility,
  });
}

function validateId(value: string): void {
  if (!isResourceId(value)) invalid();
}

function instant(value: Date): string {
  if (!Number.isFinite(value.getTime())) invalid();
  return value.toISOString();
}

function invalid(): never {
  throw new AppError({
    code: "VALIDATION_MATCH_SIGNAL_INVALID",
    message: "Entity match signal input is invalid.",
    statusCode: 400,
  });
}
