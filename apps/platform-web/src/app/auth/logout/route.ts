import { NextRequest, NextResponse } from "next/server";
import { webConfig } from "../../../shell/server/config";
import { cookieNames, cookieOptions } from "../../../shell/server/session";

export async function POST(request: NextRequest) {
  try {
    const c = webConfig();
    if (request.headers.get("origin") !== c.origin)
      return new NextResponse(null, { status: 403 });
    const response = NextResponse.redirect(new URL("/login", c.origin), 303);
    for (const name of Object.values(cookieNames(c.secure)))
      response.cookies.set(name, "", cookieOptions(c.secure, 0));
    response.headers.set("cache-control", "no-store");
    response.headers.set("clear-site-data", '"cache"');
    return response;
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
