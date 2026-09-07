import {
  DATA_CLASSIFICATIONS,
  isResourceId,
  type DataClassification,
  type ResourceRef,
} from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";

export const SUBJECT_SEED_FIELD_NAMES = [
  "DISPLAY_NAME",
  "ORGANIZATION_NAME",
  "USERNAME",
  "DOMAIN_NAME",
  "LOCATION_TEXT",
  "SOCIAL_PROFILE_URL",
] as const;
export const SUBJECT_SEED_ORIGINS = [
  "INVESTIGATOR_INPUT",
  "SOURCE_RECORD",
  "EVIDENCE",
  "ANALYSIS_EXTRACTION",
  "IMPORT",
] as const;
export type SubjectSeedFieldName = (typeof SUBJECT_SEED_FIELD_NAMES)[number];
export type SubjectSeedOrigin = (typeof SUBJECT_SEED_ORIGINS)[number];
export type ProvenanceRef = Readonly<ResourceRef & { caseId: string }>;

export type SubjectSeedFieldInput = Readonly<{
  name: SubjectSeedFieldName;
  value: string;
  origin: SubjectSeedOrigin;
  classification: DataClassification;
  evidenceRef?: ProvenanceRef | null;
  sourceRecordRef?: ProvenanceRef | null;
}>;
export type SubjectSeedField = Readonly<
  SubjectSeedFieldInput & { id: string; ordinal: number }
>;
export type SubjectSeed = Readonly<{
  id: string;
  subjectId: string;
  workspaceId: string;
  caseId: string;
  fields: readonly SubjectSeedField[];
  createdAt: string;
}>;
export type SubjectSeedSummary = Readonly<{ id: string; fieldCount: number }>;

const ALLOWED_BY_SUBJECT = {
  PERSON: ["DISPLAY_NAME", "USERNAME", "LOCATION_TEXT", "SOCIAL_PROFILE_URL"],
  ORGANIZATION: [
    "DISPLAY_NAME",
    "ORGANIZATION_NAME",
    "USERNAME",
    "DOMAIN_NAME",
    "LOCATION_TEXT",
    "SOCIAL_PROFILE_URL",
  ],
  SOCIAL_ACCOUNT: ["DISPLAY_NAME", "USERNAME", "SOCIAL_PROFILE_URL"],
  DOMAIN: ["DOMAIN_NAME"],
  UNKNOWN: SUBJECT_SEED_FIELD_NAMES,
} as const;

export function validateSubjectSeed(
  fields: readonly SubjectSeedFieldInput[],
  scope: {
    workspaceId: string;
    caseId: string;
    subjectType: keyof typeof ALLOWED_BY_SUBJECT;
  },
): SubjectSeedFieldInput[] {
  if (fields.length < 1 || fields.length > 20) invalid("fields");
  const seen = new Set<SubjectSeedFieldName>();
  return fields.map((field, index) => {
    if (!field || typeof field !== "object") invalid(`fields.${index}`);
    if (
      !SUBJECT_SEED_FIELD_NAMES.includes(field.name) ||
      !SUBJECT_SEED_ORIGINS.includes(field.origin) ||
      !DATA_CLASSIFICATIONS.includes(field.classification) ||
      !ALLOWED_BY_SUBJECT[scope.subjectType].includes(field.name as never) ||
      seen.has(field.name)
    )
      invalid(`fields.${index}`);
    seen.add(field.name);
    const value = normalizeValue(field.name, field.value);
    const evidenceRef = normalizeRef(field.evidenceRef, "EVIDENCE", scope);
    const sourceRecordRef = normalizeRef(field.sourceRecordRef, "SOURCE_RECORD", scope);
    assertProvenance(field.origin, evidenceRef, sourceRecordRef, index);
    if (field.classification === "RESTRICTED") {
      throw new AppError({
        code: "SUBJECT_SEED_RESTRICTED_STORAGE_UNAVAILABLE",
        message: "Restricted seed values require the protected identifier storage slice.",
        statusCode: 409,
      });
    }
    return Object.freeze({
      name: field.name,
      value,
      origin: field.origin,
      classification: field.classification,
      evidenceRef,
      sourceRecordRef,
    });
  });
}

export function buildSubjectSeed(
  input: {
    id: string;
    subjectId: string;
    workspaceId: string;
    caseId: string;
    subjectType: keyof typeof ALLOWED_BY_SUBJECT;
    fields: readonly (SubjectSeedFieldInput & { id: string })[];
  },
  now: Date,
): SubjectSeed {
  for (const id of [input.id, input.subjectId, input.workspaceId, input.caseId])
    if (!isResourceId(id)) invalid("id");
  const fields = validateSubjectSeed(input.fields, {
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    subjectType: input.subjectType,
  }).map((field, ordinal) => {
    if (!isResourceId(input.fields[ordinal]!.id)) invalid(`fields.${ordinal}.id`);
    return Object.freeze({ ...field, id: input.fields[ordinal]!.id, ordinal });
  });
  if (!Number.isFinite(now.getTime())) invalid("createdAt");
  return Object.freeze({
    id: input.id,
    subjectId: input.subjectId,
    workspaceId: input.workspaceId,
    caseId: input.caseId,
    fields: Object.freeze(fields),
    createdAt: now.toISOString(),
  });
}

function normalizeValue(name: SubjectSeedFieldName, value: unknown): string {
  if (typeof value !== "string") invalid("value");
  const normalized = value.trim();
  if (!normalized || normalized.length > (name === "SOCIAL_PROFILE_URL" ? 2_000 : 300))
    invalid("value");
  if (name === "DOMAIN_NAME") {
    const domain = normalized.toLowerCase();
    if (
      domain.length > 253 ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        domain,
      )
    )
      invalid("value");
    return domain;
  }
  if (name === "SOCIAL_PROFILE_URL") {
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      return invalid("value");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      invalid("value");
    const canonical = url.toString();
    if (canonical.length > 2_000) invalid("value");
    return canonical;
  }
  if (name === "USERNAME" && !/^[\p{L}\p{N}_.-]{1,100}$/u.test(normalized))
    invalid("value");
  return normalized;
}

function normalizeRef(
  value: ProvenanceRef | null | undefined,
  type: "EVIDENCE" | "SOURCE_RECORD",
  scope: { workspaceId: string; caseId: string },
): ProvenanceRef | null {
  if (value == null) return null;
  if (
    value.type !== type ||
    !isResourceId(value.id) ||
    value.workspaceId !== scope.workspaceId ||
    value.caseId !== scope.caseId ||
    Object.keys(value).some(
      (key) => !["type", "id", "workspaceId", "caseId"].includes(key),
    )
  )
    invalid("provenanceRef");
  return Object.freeze({ ...value });
}

function assertProvenance(
  origin: SubjectSeedOrigin,
  evidence: ProvenanceRef | null,
  source: ProvenanceRef | null,
  index: number,
): void {
  const valid =
    (origin === "INVESTIGATOR_INPUT" && !evidence && !source) ||
    ((origin === "EVIDENCE" || origin === "ANALYSIS_EXTRACTION") &&
      !!evidence &&
      !source) ||
    ((origin === "SOURCE_RECORD" || origin === "IMPORT") && !evidence && !!source);
  if (!valid) invalid(`fields.${index}.provenance`);
}

function invalid(field: string): never {
  throw new AppError({
    code: "VALIDATION_SUBJECT_SEED_INVALID",
    message: "Subject seed field is invalid.",
    statusCode: 400,
    details: { field },
  });
}
