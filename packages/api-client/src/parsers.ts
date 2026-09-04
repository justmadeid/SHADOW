import {
  DATA_CLASSIFICATIONS,
  isResourceId,
  type CaseAccess,
  type CaseSummary,
  type CasePage,
  type WorkspaceSummary,
} from "@intelligence/contracts";
function invalid(): never {
  throw new Error("Invalid API response");
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 255): string {
  if (typeof value !== "string" || !value.length || value.length > max) return invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!isResourceId(result)) return invalid();
  return result;
}
export function parseWorkspace(value: unknown): WorkspaceSummary {
  const r = record(value);
  return { id: id(r.id), name: text(r.name, 200) };
}
export function parseWorkspaces(value: unknown) {
  const r = record(value);
  if (!Array.isArray(r.items) || r.items.length > 100) return invalid();
  return { items: r.items.map(parseWorkspace) };
}
export function parseSession(value: unknown) {
  const r = record(value);
  const user = record(r.user);
  if (typeof r.expiresAt !== "number" || !Number.isSafeInteger(r.expiresAt))
    return invalid();
  return { user: { id: text(user.id) }, expiresAt: r.expiresAt };
}
export function parseCase(value: unknown): CaseSummary {
  const r = record(value);
  if (
    !DATA_CLASSIFICATIONS.some((c) => c === r.classification) ||
    !["DRAFT", "ACTIVE", "CLOSED", "ARCHIVED"].includes(String(r.status)) ||
    typeof r.revision !== "number" ||
    !Number.isSafeInteger(r.revision) ||
    r.revision < 1
  )
    return invalid();
  return {
    id: id(r.id),
    workspaceId: id(r.workspaceId),
    code: text(r.code),
    title: text(r.title, 200),
    classification: r.classification as CaseSummary["classification"],
    status: r.status as CaseSummary["status"],
    revision: r.revision,
  };
}
export function parseCasePage(value: unknown): CasePage {
  const r = record(value);
  const page = record(r.page);
  if (
    !Array.isArray(r.items) ||
    r.items.length > 100 ||
    typeof page.hasMore !== "boolean" ||
    !(page.nextCursor === null || typeof page.nextCursor === "string") ||
    (page.hasMore && !page.nextCursor)
  )
    return invalid();
  return {
    items: r.items.map(parseCase),
    page: {
      hasMore: page.hasMore,
      nextCursor: page.nextCursor === null ? null : text(page.nextCursor, 2048),
    },
  };
}
export function parseCaseAccess(value: unknown): CaseAccess {
  const r = record(value);
  const p = record(r.permissions);
  for (const key of ["view", "update", "createInvestigation", "manageMembers"])
    if (typeof p[key] !== "boolean") return invalid();
  return {
    caseId: id(r.caseId),
    workspaceId: id(r.workspaceId),
    permissions: {
      view: p.view as boolean,
      update: p.update as boolean,
      createInvestigation: p.createInvestigation as boolean,
      manageMembers: p.manageMembers as boolean,
    },
  };
}
