import { isResourceId } from "@intelligence/contracts";
import { AppError } from "../../../platform/errors/index.js";
import {
  SUBJECT_ROLES,
  SUBJECT_TYPES,
  type SubjectRole,
  type SubjectType,
} from "./investigation-subject.js";
import type { CreateSubjectInput, UpdateSubjectInput } from "./subject-repository.js";

export function parseCreateSubject(value: unknown): CreateSubjectInput {
  const body = record(value, ["subjectType", "role", "investigationId"]);
  if (
    !SUBJECT_TYPES.includes(body.subjectType as SubjectType) ||
    !SUBJECT_ROLES.includes(body.role as SubjectRole) ||
    (body.investigationId != null &&
      (typeof body.investigationId !== "string" || !isResourceId(body.investigationId)))
  )
    invalid();
  return {
    subjectType: body.subjectType as SubjectType,
    role: body.role as SubjectRole,
    investigationId: (body.investigationId as string | null | undefined) ?? null,
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
