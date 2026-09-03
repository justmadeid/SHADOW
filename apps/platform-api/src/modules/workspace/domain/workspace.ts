import { AppError } from "../../../platform/errors/index.js";

export type WorkspaceStatus = "ACTIVE" | "ARCHIVED";

export type WorkspaceSettings = {
  locale: string;
  timeZone: string;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  settings: WorkspaceSettings;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateWorkspaceInput = {
  name: string;
  slug: string;
  locale: string;
  timeZone: string;
};

export function validateCreateWorkspaceInput(
  input: CreateWorkspaceInput,
): CreateWorkspaceInput {
  const normalized = {
    name: input.name.trim(),
    slug: input.slug.trim().toLowerCase(),
    locale: input.locale.trim(),
    timeZone: input.timeZone.trim(),
  };

  if (normalized.name.length < 2 || normalized.name.length > 160) {
    invalid("name", "Workspace name must contain 2 to 160 characters.");
  }

  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(normalized.slug)) {
    invalid(
      "slug",
      "Workspace slug must contain 3 to 63 lowercase letters, numbers, or hyphens.",
    );
  }

  try {
    new Intl.Locale(normalized.locale);
  } catch {
    invalid("locale", "Workspace locale is invalid.");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized.timeZone }).format();
  } catch {
    invalid("timeZone", "Workspace time zone is invalid.");
  }

  return normalized;
}

function invalid(field: string, message: string): never {
  throw new AppError({
    code: "VALIDATION_WORKSPACE_INVALID",
    message,
    statusCode: 400,
    details: { field },
  });
}
