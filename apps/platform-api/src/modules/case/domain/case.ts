import { AppError } from "../../../platform/errors/index.js";

import { DATA_CLASSIFICATIONS, type DataClassification } from "@intelligence/contracts";
export { DATA_CLASSIFICATIONS, type DataClassification } from "@intelligence/contracts";
export type CaseStatus = "DRAFT" | "ACTIVE" | "CLOSED" | "ARCHIVED";
export type CaseAction = "CLOSE" | "REOPEN" | "ARCHIVE";

export type Case = {
  id: string;
  code: string;
  workspaceId: string;
  title: string;
  description: string | null;
  status: CaseStatus;
  classification: DataClassification;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  archivedAt: Date | null;
};

export type CreateCaseInput = {
  workspaceId: string;
  title: string;
  description?: string | null;
  classification: DataClassification;
};

export type UpdateCaseInput = {
  title?: string;
  description?: string | null;
  classification?: DataClassification;
};

export function validateCreateCaseInput(input: CreateCaseInput): CreateCaseInput {
  return {
    workspaceId: input.workspaceId,
    title: normalizeTitle(input.title),
    description: normalizeDescription(input.description),
    classification: normalizeClassification(input.classification),
  };
}

export function validateUpdateCaseInput(input: UpdateCaseInput): UpdateCaseInput {
  if (
    input.title === undefined &&
    input.description === undefined &&
    input.classification === undefined
  ) {
    invalid("body", "At least one mutable Case field is required.");
  }

  return {
    ...(input.title === undefined ? {} : { title: normalizeTitle(input.title) }),
    ...(input.description === undefined
      ? {}
      : { description: normalizeDescription(input.description) }),
    ...(input.classification === undefined
      ? {}
      : { classification: normalizeClassification(input.classification) }),
  };
}

export function nextCaseStatus(current: CaseStatus, action: CaseAction): CaseStatus {
  if (action === "CLOSE" && (current === "DRAFT" || current === "ACTIVE")) {
    return "CLOSED";
  }

  if (action === "REOPEN" && current === "CLOSED") {
    return "ACTIVE";
  }

  if (action === "ARCHIVE" && current !== "ARCHIVED") {
    return "ARCHIVED";
  }

  throw new AppError({
    code: "CASE_INVALID_STATUS_TRANSITION",
    message: `Case cannot perform ${action} while it is ${current}.`,
    statusCode: 409,
    details: { action, currentStatus: current },
  });
}

export function assertCaseMutable(status: CaseStatus): void {
  if (status === "CLOSED" || status === "ARCHIVED") {
    throw new AppError({
      code: "CASE_NOT_MUTABLE",
      message: `Case metadata cannot be changed while it is ${status}.`,
      statusCode: 409,
      details: { status },
    });
  }
}

function normalizeTitle(value: string): string {
  const title = value.trim();
  if (title.length < 3 || title.length > 200) {
    invalid("title", "Case title must contain 3 to 200 characters.");
  }
  return title;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const description = value.trim();
  if (description.length > 4_000) {
    invalid("description", "Case description cannot exceed 4000 characters.");
  }
  return description || null;
}

function normalizeClassification(value: DataClassification): DataClassification {
  if (!DATA_CLASSIFICATIONS.includes(value)) {
    invalid("classification", "Case classification is invalid.");
  }
  return value;
}

function invalid(field: string, message: string): never {
  throw new AppError({
    code: "VALIDATION_CASE_INVALID",
    message,
    statusCode: 400,
    details: { field },
  });
}
