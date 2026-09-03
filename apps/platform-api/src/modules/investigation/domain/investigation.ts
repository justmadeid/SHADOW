import { AppError } from "../../../platform/errors/index.js";

export const INVESTIGATION_STATUSES = [
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type InvestigationStatus = (typeof INVESTIGATION_STATUSES)[number];

export type Investigation = {
  id: string;
  workspaceId: string;
  caseId: string;
  title: string;
  objective: string;
  status: InvestigationStatus;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  archivedAt: Date | null;
};

export type CreateInvestigationInput = {
  title: string;
  objective: string;
};

export type UpdateInvestigationInput = {
  title?: string;
  objective?: string;
  status?: InvestigationStatus;
};

export function validateCreateInvestigationInput(
  input: CreateInvestigationInput,
): CreateInvestigationInput {
  return {
    title: normalizeText(input.title, "title", 3, 200),
    objective: normalizeText(input.objective, "objective", 3, 2_000),
  };
}

export function validateUpdateInvestigationInput(
  input: UpdateInvestigationInput,
): UpdateInvestigationInput {
  if (
    input.title === undefined &&
    input.objective === undefined &&
    input.status === undefined
  ) {
    invalid("body", "At least one mutable Investigation field is required.");
  }

  return {
    ...(input.title === undefined
      ? {}
      : { title: normalizeText(input.title, "title", 3, 200) }),
    ...(input.objective === undefined
      ? {}
      : { objective: normalizeText(input.objective, "objective", 3, 2_000) }),
    ...(input.status === undefined ? {} : { status: normalizeStatus(input.status) }),
  };
}

export function assertInvestigationUpdateAllowed(
  current: InvestigationStatus,
  target: InvestigationStatus | undefined,
): void {
  if (current === "ARCHIVED") {
    conflict(current, target, "Archived Investigations are immutable.");
  }

  if (target === undefined || target === current) {
    return;
  }

  const allowed: Record<InvestigationStatus, InvestigationStatus[]> = {
    ACTIVE: ["PAUSED", "COMPLETED", "ARCHIVED"],
    PAUSED: ["ACTIVE", "COMPLETED", "ARCHIVED"],
    COMPLETED: ["ACTIVE", "ARCHIVED"],
    ARCHIVED: [],
  };

  if (!allowed[current].includes(target)) {
    conflict(current, target, "Investigation status transition is not allowed.");
  }
}

function normalizeText(
  value: string,
  field: "title" | "objective",
  min: number,
  max: number,
): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    invalid(field, `Investigation ${field} must contain ${min} to ${max} characters.`);
  }
  return normalized;
}

function normalizeStatus(value: InvestigationStatus): InvestigationStatus {
  if (!INVESTIGATION_STATUSES.includes(value)) {
    invalid("status", "Investigation status is invalid.");
  }
  return value;
}

function invalid(field: string, message: string): never {
  throw new AppError({
    code: "VALIDATION_INVESTIGATION_INVALID",
    message,
    statusCode: 400,
    details: { field },
  });
}

function conflict(
  currentStatus: InvestigationStatus,
  targetStatus: InvestigationStatus | undefined,
  message: string,
): never {
  throw new AppError({
    code: "INVESTIGATION_INVALID_STATUS_TRANSITION",
    message,
    statusCode: 409,
    details: { currentStatus, targetStatus },
  });
}
