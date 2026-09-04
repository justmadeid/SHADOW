export type { ResourceRef } from "@intelligence/contracts";
export {
  parseCase,
  parseCaseAccess,
  parseCasePage,
  parseWorkspace,
  parseWorkspaces,
} from "./parsers.js";
import {
  parseCase,
  parseCaseAccess,
  parseCasePage,
  parseSession,
  parseWorkspace,
  parseWorkspaces,
} from "./parsers.js";

export type ApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const request = async <T>(
    path: string,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<T> => {
    try {
      const response = await (options.fetch ?? fetch)(`${baseUrl}${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw new ApiError(response.status);
      return parse(await response.json());
    } catch (error) {
      if (error instanceof ApiError || signal?.aborted) throw error;
      throw new ApiError(502);
    }
  };
  return {
    baseUrl,
    session: (signal?: AbortSignal) => request("/session", parseSession, signal),
    workspaces: (signal?: AbortSignal) => request("/workspaces", parseWorkspaces, signal),
    workspace: (id: string, signal?: AbortSignal) =>
      request(`/workspaces/${encodeURIComponent(id)}`, parseWorkspace, signal),
    cases: (workspaceId: string, cursor: string | null, signal?: AbortSignal) =>
      request(
        `/cases?${new URLSearchParams({ workspaceId, ...(cursor ? { cursor } : {}) })}`,
        parseCasePage,
        signal,
      ),
    case: (id: string, signal?: AbortSignal) =>
      request(`/cases/${encodeURIComponent(id)}`, parseCase, signal),
    caseAccess: (id: string, signal?: AbortSignal) =>
      request(`/cases/${encodeURIComponent(id)}/access`, parseCaseAccess, signal),
  };
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "Session expired. Sign in again."
        : status === 403 || status === 404
          ? "This context is unavailable or you do not have access."
          : "The platform could not be reached. Please retry.",
    );
  }
}
