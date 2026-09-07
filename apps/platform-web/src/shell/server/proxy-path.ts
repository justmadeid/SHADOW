import { isResourceId } from "@intelligence/contracts";

/** Read-only allowlist, not an arbitrary proxy. Never forwards user headers or URLs. */
export function proxyPath(segments: string[], query: URLSearchParams): string | null {
  const path = segments.join("/");
  if (path === "workspaces" && query.size === 0) return "/workspaces";
  if (
    segments[0] === "workspaces" &&
    segments.length === 2 &&
    isResourceId(segments[1]!) &&
    query.size === 0
  )
    return `/${path}`;
  if (
    segments[0] === "cases" &&
    segments.length >= 2 &&
    isResourceId(segments[1]!) &&
    (segments.length === 2 || (segments.length === 3 && segments[2] === "access")) &&
    query.size === 0
  )
    return `/${path}`;
  if (
    segments[0] === "cases" &&
    segments.length === 3 &&
    isResourceId(segments[1]!) &&
    segments[2] === "investigations" &&
    query.size === 0
  )
    return `/${path}`;
  if (
    path === "cases" &&
    isResourceId(query.get("workspaceId") ?? "") &&
    query.getAll("workspaceId").length === 1 &&
    query.getAll("cursor").length <= 1 &&
    (query.get("cursor")?.length ?? 0) <= 2048 &&
    [...query.keys()].every((k) => ["workspaceId", "cursor"].includes(k))
  )
    return `/cases?${query}`;
  return null;
}

/** Mutation allowlist. Bodies and headers are validated separately. */
export function mutationPath(
  method: "POST" | "PATCH",
  segments: string[],
): "CREATE_CASE" | "UPDATE_CASE" | "TRANSITION_CASE" | "CREATE_INVESTIGATION" | null {
  if (method === "POST" && segments.length === 1 && segments[0] === "cases")
    return "CREATE_CASE";
  if (
    method === "PATCH" &&
    segments.length === 2 &&
    segments[0] === "cases" &&
    isResourceId(segments[1]!)
  )
    return "UPDATE_CASE";
  if (
    method === "POST" &&
    segments.length === 4 &&
    segments[0] === "cases" &&
    isResourceId(segments[1]!) &&
    segments[2] === "actions" &&
    ["close", "reopen", "archive"].includes(segments[3]!)
  )
    return "TRANSITION_CASE";
  if (
    method === "POST" &&
    segments.length === 3 &&
    segments[0] === "cases" &&
    isResourceId(segments[1]!) &&
    segments[2] === "investigations"
  )
    return "CREATE_INVESTIGATION";
  return null;
}
