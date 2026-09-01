export type ClientApplication =
  "SHADOW" | "ECHO" | "SPECTRA" | "INTERNAL_WORKER" | "UNKNOWN";

export type RequestContext = {
  requestId: string;
  traceId: string;

  userId?: string;
  workspaceId?: string;
  caseId?: string;
  investigationId?: string;

  reasonForAccess?: string;
  clientApplication?: ClientApplication;

  issuedAt: string;
};
