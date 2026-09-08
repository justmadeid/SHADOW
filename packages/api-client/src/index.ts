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
  parseCandidate,
  parseCandidatePage,
  parseCandidateResolution,
  parseEntityMatchPage,
  parseResolutionSession,
  parseStartResolution,
  parseSubject,
  parseSubjectPage,
  parseSubjectSeed,
  parseTargetProfile,
} from "./parsers.js";
import type {
  DataClassification,
  ResolutionReasonCode,
  SubjectRole,
  SubjectSeedFieldName,
  SubjectType,
} from "@intelligence/contracts";
import {
  parseCaseAccess,
  parseCaseDetail,
  parseCasePage,
  parseInvestigation,
  parseInvestigations,
  parseSession,
  parseWorkspace,
  parseWorkspaces,
  parseCandidatePage,
  parseCandidateResolution,
  parseEntityMatchPage,
  parseResolutionSession,
  parseStartResolution,
  parseSubject,
  parseSubjectPage,
  parseSubjectSeed,
  parseTargetProfile,
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
export type CreateSubjectInput = {
  subjectType: SubjectType;
  role: SubjectRole;
  investigationId?: string | null;
  seed: {
    fields: Array<{
      name: SubjectSeedFieldName;
      value: string;
      origin: "INVESTIGATOR_INPUT";
      classification: Exclude<DataClassification, "RESTRICTED">;
    }>;
  };
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
  const mutation = async <T>(
    path: string,
    method: "POST" | "PATCH",
    body: object | undefined,
    parse: (value: unknown) => T,
    mutationOptions: {
      revision?: number;
      idempotencyKey?: string;
      auditOperationId?: string;
    } = {},
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
          ...(mutationOptions.auditOperationId
            ? { "x-audit-operation-id": mutationOptions.auditOperationId }
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
    subjects: (caseId: string, signal?: AbortSignal) =>
      request(`/cases/${encodeURIComponent(caseId)}/subjects`, parseSubjectPage, signal),
    subjectSeed: (subjectId: string, signal?: AbortSignal) =>
      request(
        `/subjects/${encodeURIComponent(subjectId)}/seed`,
        parseSubjectSeed,
        signal,
      ),
    subjectResolution: (subjectId: string, signal?: AbortSignal) =>
      request(
        `/subjects/${encodeURIComponent(subjectId)}/resolution`,
        parseResolutionSession,
        signal,
      ),
    createSubject: (caseId: string, input: CreateSubjectInput, idempotencyKey: string) =>
      mutation(
        `/cases/${encodeURIComponent(caseId)}/subjects`,
        "POST",
        input,
        parseSubject,
        { idempotencyKey },
      ),
    startResolution: (subjectId: string, revision: number, idempotencyKey: string) =>
      mutation(
        `/subjects/${encodeURIComponent(subjectId)}/actions/start-resolution`,
        "POST",
        undefined,
        parseStartResolution,
        { revision, idempotencyKey },
      ),
    resolution: (resolutionId: string, signal?: AbortSignal) =>
      request(
        `/resolutions/${encodeURIComponent(resolutionId)}`,
        parseResolutionSession,
        signal,
      ),
    candidates: (resolutionId: string, signal?: AbortSignal) =>
      request(
        `/resolutions/${encodeURIComponent(resolutionId)}/candidates`,
        parseCandidatePage,
        signal,
      ),
    matches: (resolutionId: string, signal?: AbortSignal) =>
      request(
        `/resolutions/${encodeURIComponent(resolutionId)}/matches`,
        parseEntityMatchPage,
        signal,
      ),
    resolveCandidate: (
      candidateId: string,
      input: {
        decision: "LINK_EXISTING" | "CREATE_NEW" | "UNCERTAIN" | "REJECT";
        entityId?: string;
        reasonCode: ResolutionReasonCode;
      },
      revision: number,
      idempotencyKey: string,
      auditOperationId: string,
    ) =>
      mutation(
        `/candidates/${encodeURIComponent(candidateId)}/actions/resolve`,
        "POST",
        input,
        parseCandidateResolution,
        { revision, idempotencyKey, auditOperationId },
      ),
    targetProfile: (caseId: string, subjectId: string, signal?: AbortSignal) =>
      request(
        `/shadow/cases/${encodeURIComponent(caseId)}/targets/${encodeURIComponent(subjectId)}`,
        parseTargetProfile,
        signal,
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
