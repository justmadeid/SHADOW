import { DATA_CLASSIFICATIONS, isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import {
  SUBJECT_ROLES,
  SUBJECT_TYPES,
  type SubjectRole,
  type SubjectType,
} from "./investigation-subject.js";
import type { CreateSubjectInput, UpdateSubjectInput } from "./subject-repository.js";
import { SUBJECT_SEED_FIELD_NAMES, type SubjectSeedFieldInput } from "./subject-seed.js";

export function parseCreateSubject(value: unknown): CreateSubjectInput {
  const body = record(value, ["subjectType", "role", "investigationId", "seed"]);
  if (
    !SUBJECT_TYPES.includes(body.subjectType as SubjectType) ||
    !SUBJECT_ROLES.includes(body.role as SubjectRole) ||
    (body.investigationId != null &&
      (typeof body.investigationId !== "string" || !isResourceId(body.investigationId)))
  )
    invalid();
  const seed = body.seed === undefined ? undefined : parsePublicSeed(body.seed);
  return {
    subjectType: body.subjectType as SubjectType,
    role: body.role as SubjectRole,
    investigationId: (body.investigationId as string | null | undefined) ?? null,
    ...(seed ? { seed } : {}),
  };
}

function parsePublicSeed(value: unknown): { fields: SubjectSeedFieldInput[] } {
  const seed = record(value, ["fields"]);
  if (!Array.isArray(seed.fields) || seed.fields.length < 1 || seed.fields.length > 20)
    invalid();
  return {
    fields: seed.fields.map((value) => {
      const field = record(value, ["name", "value", "origin", "classification"]);
      if (
        !SUBJECT_SEED_FIELD_NAMES.includes(field.name as never) ||
        typeof field.value !== "string" ||
        field.origin !== "INVESTIGATOR_INPUT" ||
        !DATA_CLASSIFICATIONS.includes(field.classification as never)
      )
        invalid();
      return field as unknown as SubjectSeedFieldInput;
    }),
  };
}
export function parseUpdateSubject(value: unknown): UpdateSubjectInput {
  const body = record(value, ["role", "status"]);
  if (Object.keys(body).length !== 1) invalid();
  if (body.status === "ARCHIVED") return { status: "ARCHIVED" };
  if (SUBJECT_ROLES.includes(body.role as SubjectRole))
    return { role: body.role as SubjectRole };
  return invalid();
}
function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) invalid();
  return body;
}
function invalid(): never {
  throw new AppError({
    code: "VALIDATION_SUBJECT_INVALID",
    message: "Subject request body is invalid.",
    statusCode: 400,
  });
}
