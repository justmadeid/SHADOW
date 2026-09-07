import { NextRequest, NextResponse } from "next/server";
import {
  parseCaseAccess,
  parseCaseDetail,
  parseCasePage,
  parseInvestigation,
  parseInvestigations,
  parseWorkspace,
  parseWorkspaces,
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
    const parse =
      segments[0] === "workspaces"
        ? segments.length === 1
          ? parseWorkspaces
          : parseWorkspace
        : segments.length === 1
          ? parseCasePage
          : segments[2] === "access"
            ? parseCaseAccess
            : segments[2] === "investigations"
              ? parseInvestigations
              : parseCaseDetail;
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
    return NextResponse.json(
      kind === "CREATE_INVESTIGATION"
        ? parseInvestigation(await response.json())
        : parseCaseDetail(await response.json()),
      { status: response.status, headers },
    );
  } catch {
    return failure(503);
  }
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
