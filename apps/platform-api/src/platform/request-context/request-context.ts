import type { AuthenticatedPrincipal } from "@intelligence/auth";

export type ClientApplication =
  "SHADOW" | "ECHO" | "SPECTRA" | "INTERNAL_WORKER" | "UNKNOWN";

export type RequestContext = {
  requestId: string;
  traceId: string;

  principal?: AuthenticatedPrincipal;
  userId?: string;
  serviceId?: string;
  workspaceId?: string;
  caseId?: string;
  investigationId?: string;

  reasonForAccess?: string;
  clientApplication?: ClientApplication;

  issuedAt: string;
};
