import { isResourceId } from "@intelligence/contracts";

export type MutationKind =
  | "CREATE_CASE"
  | "UPDATE_CASE"
  | "TRANSITION_CASE"
  | "CREATE_INVESTIGATION"
  | "CREATE_SUBJECT"
  | "START_RESOLUTION"
  | "RESOLVE_CANDIDATE";

/** Read-only allowlist, not an arbitrary proxy. Never forwards user headers or URLs. */
export function proxyPath(segments: string[], query: URLSearchParams): string | null {
  const path = segments.join("/");
  if (path === "workspaces" && query.size === 0) return "/workspaces";
  if (detail(segments, "workspaces") && query.size === 0) return `/${path}`;
  if (
    segments[0] === "cases" &&
    isResourceId(segments[1] ?? "") &&
    (segments.length === 2 || (segments.length === 3 && segments[2] === "access")) &&
    query.size === 0
  )
    return `/${path}`;
  if (
    segments[0] === "cases" &&
    isResourceId(segments[1] ?? "") &&
    segments.length === 3 &&
    segments[2] === "investigations" &&
    query.size === 0
  )
    return `/${path}`;
  if (
    segments[0] === "cases" &&
    isResourceId(segments[1] ?? "") &&
    segments.length === 3 &&
    segments[2] === "subjects" &&
    boundedPageQuery(query)
  )
    return `/${path}${query.size ? `?${query}` : ""}`;
  if (
    segments[0] === "subjects" &&
    isResourceId(segments[1] ?? "") &&
    (segments.length === 2 ||
      (segments.length === 3 && ["seed", "resolution"].includes(segments[2]!))) &&
    query.size === 0
  )
    return `/${path}`;
  if (
    segments[0] === "resolutions" &&
    isResourceId(segments[1] ?? "") &&
    (segments.length === 2 ||
      (segments.length === 3 && ["candidates", "matches"].includes(segments[2]!))) &&
    (segments.length === 2 ? query.size === 0 : boundedPageQuery(query))
  )
    return `/${path}${query.size ? `?${query}` : ""}`;
  if (detail(segments, "candidates") && query.size === 0) return `/${path}`;
  if (
    segments[0] === "shadow" &&
    segments[1] === "cases" &&
    isResourceId(segments[2] ?? "") &&
    segments[3] === "targets" &&
    isResourceId(segments[4] ?? "") &&
    segments.length === 5 &&
    query.size === 0
  )
    return `/${path}`;
  if (
    path === "cases" &&
    isResourceId(query.get("workspaceId") ?? "") &&
    query.getAll("workspaceId").length === 1 &&
    query.getAll("cursor").length <= 1 &&
    (query.get("cursor")?.length ?? 0) <= 2048 &&
    [...query.keys()].every((key) => ["workspaceId", "cursor"].includes(key))
  )
    return `/cases?${query}`;
  return null;
}

/** Mutation allowlist. Bodies and headers are validated separately. */
export function mutationPath(
  method: "POST" | "PATCH",
  segments: string[],
): MutationKind | null {
  if (method === "POST" && segments.length === 1 && segments[0] === "cases")
    return "CREATE_CASE";
  if (method === "PATCH" && detail(segments, "cases")) return "UPDATE_CASE";
  if (
    method === "POST" &&
    segments[0] === "cases" &&
    isResourceId(segments[1] ?? "") &&
    segments[2] === "actions" &&
    ["close", "reopen", "archive"].includes(segments[3] ?? "") &&
    segments.length === 4
  )
    return "TRANSITION_CASE";
  if (
    method === "POST" &&
    segments[0] === "cases" &&
    isResourceId(segments[1] ?? "") &&
    segments[2] === "investigations" &&
    segments.length === 3
  )
    return "CREATE_INVESTIGATION";
  if (
    method === "POST" &&
    segments[0] === "cases" &&
    isResourceId(segments[1] ?? "") &&
    segments[2] === "subjects" &&
    segments.length === 3
  )
    return "CREATE_SUBJECT";
  if (
    method === "POST" &&
    segments[0] === "subjects" &&
    isResourceId(segments[1] ?? "") &&
    segments[2] === "actions" &&
    segments[3] === "start-resolution" &&
    segments.length === 4
  )
    return "START_RESOLUTION";
  if (
    method === "POST" &&
    segments[0] === "candidates" &&
    isResourceId(segments[1] ?? "") &&
    segments[2] === "actions" &&
    segments[3] === "resolve" &&
    segments.length === 4
  )
    return "RESOLVE_CANDIDATE";
  return null;
}

function detail(segments: string[], root: string): boolean {
  return segments.length === 2 && segments[0] === root && isResourceId(segments[1]!);
}

function boundedPageQuery(query: URLSearchParams): boolean {
  const limit = query.get("limit");
  return (
    query.getAll("cursor").length <= 1 &&
    query.getAll("limit").length <= 1 &&
    (query.get("cursor")?.length ?? 0) <= 2048 &&
    (limit === null || (/^[1-9][0-9]{0,2}$/.test(limit) && Number(limit) <= 100)) &&
    [...query.keys()].every((key) => ["cursor", "limit"].includes(key))
  );
}
