import { NextRequest, NextResponse } from "next/server";
import {
  parseCase,
  parseCaseAccess,
  parseCasePage,
  parseWorkspace,
  parseWorkspaces,
} from "@intelligence/api-client";
import { readSession, upstream, verifiedSession } from "../../../../shell/server/session";
import { proxyPath } from "../../../../shell/server/proxy-path";

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
          : segments.length === 2
            ? parseCase
            : parseCaseAccess;
    return NextResponse.json(parse(await response.json()), { headers });
  } catch {
    return failure(503);
  }
}
function failure(status: number) {
  return NextResponse.json(
    {
      error: {
        code: status === 401 ? "AUTH_SESSION_EXPIRED" : "PLATFORM_REQUEST_FAILED",
        message: "The request could not be completed.",
      },
    },
    { status, headers },
  );
}
