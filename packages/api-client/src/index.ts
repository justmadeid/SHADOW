export type { ResourceRef } from "@intelligence/contracts";
export {
  parseCase,
  parseCaseAccess,
  parseCaseDetail,
  parseCasePage,
  parseWorkspace,
  parseWorkspaces,
  parseInvestigation,
  parseInvestigations,
} from "./parsers.js";
import type { DataClassification } from "@intelligence/contracts";
import {
  parseCaseAccess,
  parseCaseDetail,
  parseCasePage,
  parseInvestigation,
  parseInvestigations,
  parseSession,
  parseWorkspace,
  parseWorkspaces,
} from "./parsers.js";

export type ApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};
export type CreateCaseInput = {
  workspaceId: string;
  title: string;
  description: string | null;
  classification: DataClassification;
};
export type UpdateCaseInput = Omit<CreateCaseInput, "workspaceId">;
export type CreateInvestigationInput = { title: string; objective: string };

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
  const mutation = async <T>(
    path: string,
    method: "POST" | "PATCH",
    body: object | undefined,
    parse: (value: unknown) => T,
    mutationOptions: { revision?: number; idempotencyKey?: string } = {},
  ): Promise<T> => {
    try {
      const response = await (options.fetch ?? fetch)(`${baseUrl}${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(mutationOptions.revision
            ? { "if-match": `"${mutationOptions.revision}"` }
            : {}),
          ...(mutationOptions.idempotencyKey
            ? { "idempotency-key": mutationOptions.idempotencyKey }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new ApiError(response.status);
      return parse(await response.json());
    } catch (error) {
      if (error instanceof ApiError) throw error;
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
      request(`/cases/${encodeURIComponent(id)}`, parseCaseDetail, signal),
    caseAccess: (id: string, signal?: AbortSignal) =>
      request(`/cases/${encodeURIComponent(id)}/access`, parseCaseAccess, signal),
    createCase: (input: CreateCaseInput, idempotencyKey: string) =>
      mutation("/cases", "POST", input, parseCaseDetail, { idempotencyKey }),
    updateCase: (id: string, input: UpdateCaseInput, revision: number) =>
      mutation(`/cases/${encodeURIComponent(id)}`, "PATCH", input, parseCaseDetail, {
        revision,
      }),
    transitionCase: (
      id: string,
      action: "close" | "reopen" | "archive",
      revision: number,
    ) =>
      mutation(
        `/cases/${encodeURIComponent(id)}/actions/${action}`,
        "POST",
        undefined,
        parseCaseDetail,
        { revision },
      ),
    investigations: (caseId: string, signal?: AbortSignal) =>
      request(
        `/cases/${encodeURIComponent(caseId)}/investigations`,
        parseInvestigations,
        signal,
      ),
    createInvestigation: (
      caseId: string,
      input: CreateInvestigationInput,
      idempotencyKey: string,
    ) =>
      mutation(
        `/cases/${encodeURIComponent(caseId)}/investigations`,
        "POST",
        input,
        parseInvestigation,
        { idempotencyKey },
      ),
  };
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(
      status === 401
        ? "Session expired. Sign in again."
        : status === 400
          ? "Check the form values and try again."
          : status === 403 || status === 404
            ? "This context is unavailable or you do not have access."
            : status === 409
              ? "This action is not allowed in the current state."
              : status === 412
                ? "This record changed elsewhere. Reload it before trying again."
                : "The platform could not be reached. Please retry.",
    );
  }
}
