import { NextRequest, NextResponse } from "next/server";
import {
  parseCaseAccess,
  parseCaseDetail,
  parseCasePage,
  parseInvestigation,
  parseInvestigations,
  parseWorkspace,
  parseWorkspaces,
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
} from "@intelligence/api-client";
import { readSession, upstream, verifiedSession } from "../../../../shell/server/session";
import {
  parseMutationInput,
  readMutationBody,
} from "../../../../shell/server/mutation-input";
import { mutationPath, proxyPath } from "../../../../shell/server/proxy-path";
import { webConfig } from "../../../../shell/server/config";

const headers = {
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: segments } = await params;
    if (segments.join("/") === "session" && request.nextUrl.searchParams.size === 0) {
      const session = await verifiedSession();
      return session
        ? NextResponse.json(
            { user: { id: session.userId }, expiresAt: session.expiresAt },
            { headers },
          )
        : failure(401);
    }
    const path = proxyPath(segments, request.nextUrl.searchParams);
    if (!path) return failure(404);
    const session = await readSession();
    if (!session) return failure(401);
    const response = await upstream(path, session.token);
    if (!response.ok)
      return failure(
        [400, 401, 403, 404, 429].includes(response.status) ? response.status : 502,
      );
    const parse = readParser(segments);
    return NextResponse.json(parse(await response.json()), { headers });
  } catch {
    return failure(503);
  }
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return mutate("POST", request, context);
}
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return mutate("PATCH", request, context);
}
async function mutate(
  method: "POST" | "PATCH",
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const c = webConfig();
    if (request.headers.get("origin") !== c.origin) return failure(403);
    if (request.nextUrl.searchParams.size) return failure(404);
    const { path: segments } = await params;
    const kind = mutationPath(method, segments);
    if (!kind) return failure(404);
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > 8192) return failure(413);
    const raw = await readMutationBody(request.body);
    if (raw === null) return failure(413);
    const input = parseMutationInput(kind, raw, request.headers);
    if (!input) return failure(400);
    const session = await readSession();
    if (!session) return failure(401);
    const path = `/${segments.join("/")}`;
    const response = await upstream(path, session.token, { method, ...input });
    if (!response.ok)
      return failure(
        [400, 401, 403, 404, 409, 412, 429].includes(response.status)
          ? response.status
          : 502,
      );
    const body = await response.json();
    const parsed =
      kind === "CREATE_INVESTIGATION"
        ? parseInvestigation(body)
        : kind === "CREATE_SUBJECT"
          ? parseSubject(body)
          : kind === "START_RESOLUTION"
            ? parseStartResolution(body)
            : kind === "RESOLVE_CANDIDATE"
              ? parseCandidateResolution(body)
              : parseCaseDetail(body);
    return NextResponse.json(parsed, { status: response.status, headers });
  } catch {
    return failure(503);
  }
}
function readParser(segments: string[]): (value: unknown) => unknown {
  if (segments[0] === "workspaces")
    return segments.length === 1 ? parseWorkspaces : parseWorkspace;
  if (segments[0] === "shadow") return parseTargetProfile;
  if (segments[0] === "subjects")
    return segments[2] === "seed"
      ? parseSubjectSeed
      : segments[2] === "resolution"
        ? parseResolutionSession
        : parseSubject;
  if (segments[0] === "resolutions")
    return segments[2] === "candidates"
      ? parseCandidatePage
      : segments[2] === "matches"
        ? parseEntityMatchPage
        : parseResolutionSession;
  if (segments[0] === "candidates") return parseCandidate;
  if (segments.length === 1) return parseCasePage;
  if (segments[2] === "access") return parseCaseAccess;
  if (segments[2] === "investigations") return parseInvestigations;
  if (segments[2] === "subjects") return parseSubjectPage;
  return parseCaseDetail;
}
function failure(status: number) {
  return NextResponse.json(
    {
      error: {
        code:
          status === 401
            ? "AUTH_SESSION_EXPIRED"
            : status === 412
              ? "CONFLICT_REVISION_MISMATCH"
              : status === 413
                ? "VALIDATION_PAYLOAD_TOO_LARGE"
                : "PLATFORM_REQUEST_FAILED",
        message: "The request could not be completed.",
      },
    },
    { status, headers },
  );
}
